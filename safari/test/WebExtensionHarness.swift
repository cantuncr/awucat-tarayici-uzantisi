// Loads the built Safari extension (apps/browser-extension/dist/safari) into macOS's own
// WebKit extension engine — WKWebExtension / WKWebExtensionController, the same engine Safari
// uses — and exercises it in off-screen WKWebViews. Driven by test/run.mjs, which prepares a
// test copy of the extension and serves the pages.
//
//   WebExtensionHarness <extension dir> <whatsapp-like page URL> <fixture.udf> [<app URL>]
//
// What this proves that Playwright's WebKit cannot: the Safari manifest is parsed by WebKit's
// extension engine, `"world": "MAIN"` content scripts really run in the page world, the
// isolated-world script gets real extension APIs, and the filename WebKit hands to the
// download delegate (what Safari saves) is the corrected ".udf" one. With an app URL it also
// runs the popup/picker handover: extension page → background → tabs.create → content script.
//
// What it cannot prove: Safari.app's own UI (toolbar, permission prompts, context menus,
// Downloads folder handling). Those need a manual run — see ../README.md.

import AppKit
import WebKit

@MainActor
final class Harness: NSObject, WKNavigationDelegate, WKDownloadDelegate {
    var loaded: CheckedContinuation<Void, Never>?
    var pendingDownload: CheckedContinuation<(String, Data?), Never>?
    private var lastName = ""
    private var lastDest: URL?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        navigationAction.shouldPerformDownload ? .download : .allow
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        navigationResponse.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// `suggestedFilename` is the name WebKit hands to the browser — what Safari would save.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        lastName = suggestedFilename
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent("awucat-harness-\(UUID().uuidString)")
        lastDest = dest
        return dest
    }

    func downloadDidFinish(_ download: WKDownload) {
        let data = lastDest.flatMap { try? Data(contentsOf: $0) }
        if let dest = lastDest { try? FileManager.default.removeItem(at: dest) }
        pendingDownload?.resume(returning: (lastName, data))
        pendingDownload = nil
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        pendingDownload?.resume(returning: ("FAILED: \(error.localizedDescription)", nil))
        pendingDownload = nil
    }
}

/// Minimal browser tab/window model so `tabs.create` / `tabs.sendMessage` work.
@MainActor
final class Tab: NSObject, WKWebExtensionTab {
    let view: WKWebView
    weak var owner: Window?
    init(_ view: WKWebView) { self.view = view }
    func webView(for context: WKWebExtensionContext) -> WKWebView? { view }
    func url(for context: WKWebExtensionContext) -> URL? { view.url }
    func isSelected(for context: WKWebExtensionContext) -> Bool { true }
    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { owner }
}

@MainActor
final class Window: NSObject, WKWebExtensionWindow {
    var tabs: [Tab] = []
    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { tabs }
    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { tabs.last }
}

@MainActor
final class Browser: NSObject, WKWebExtensionControllerDelegate {
    let window = Window()
    var hosts: [NSWindow] = []
    weak var navigationDelegate: WKNavigationDelegate?

    func webExtensionController(_ controller: WKWebExtensionController, openWindowsFor extensionContext: WKWebExtensionContext) -> [any WKWebExtensionWindow] { [window] }
    func webExtensionController(_ controller: WKWebExtensionController, focusedWindowFor extensionContext: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { window }

    func webExtensionController(_ controller: WKWebExtensionController, openNewTabUsing configuration: WKWebExtension.TabConfiguration, for extensionContext: WKWebExtensionContext) async throws -> (any WKWebExtensionTab)? {
        let view = makeWebView(controller)
        view.navigationDelegate = navigationDelegate
        let tab = Tab(view)
        tab.owner = window
        window.tabs.append(tab)
        if let url = configuration.url { view.load(URLRequest(url: url)) }
        return tab
    }

    func makeWebView(_ controller: WKWebExtensionController) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.webExtensionController = controller
        config.preferences.inactiveSchedulingPolicy = .none // off-screen views must not be throttled
        // Diagnostics: page-world log of the app ↔ extension messages (printed when a check fails).
        config.userContentController.addUserScript(WKUserScript(source: """
            window.__udfLog = [];
            addEventListener("message", (e) => { const t = e.data && e.data.type; if (typeof t === "string" && t.startsWith("awucat")) __udfLog.push(Math.round(performance.now()) + "ms " + t); });
            addEventListener("error", (e) => __udfLog.push("error: " + e.message));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 900), configuration: config)
        // Host it in an off-screen window so layout, timers and animation frames run normally.
        let host = NSWindow(contentRect: NSRect(x: -4000, y: -4000, width: 1200, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
        host.contentView = view
        host.orderBack(nil)
        hosts.append(host)
        return view
    }
}

@MainActor
func run() async throws -> Int32 {
    let args = CommandLine.arguments
    guard args.count >= 4 else {
        print("usage: WebExtensionHarness <extension dir> <page URL> <fixture.udf> [<app URL>]")
        return 2
    }
    let extensionURL = URL(fileURLWithPath: args[1], isDirectory: true)
    let pageURL = args[2]
    let fixture = try Data(contentsOf: URL(fileURLWithPath: args[3]))
    let appURL = args.count > 4 ? args[4] : nil

    var failures = 0
    func check(_ name: String, _ ok: Bool, _ detail: String = "") {
        if !ok { failures += 1 }
        print("\(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    }

    // ---- manifest -------------------------------------------------------------------------
    let ext = try await WKWebExtension(resourceBaseURL: extensionURL)
    print("\(ext.displayName ?? "?") v\(ext.version ?? "?") · manifest v\(ext.manifestVersion)")
    check("manifest parsed by WebKit without errors or warnings", ext.errors.isEmpty, ext.errors.map { $0.localizedDescription }.joined(separator: " | "))
    print("      permissions: \(ext.requestedPermissions.map { $0.rawValue }.sorted().joined(separator: ", "))")
    print("      optional host access: \(ext.optionalPermissionMatchPatterns.map { $0.description }.sorted().joined(separator: ", "))")
    check("non-persistent background page", ext.hasBackgroundContent && !ext.hasPersistentBackgroundContent)
    check("content scripts present", ext.hasInjectedContent)

    let context = WKWebExtensionContext(for: ext)
    context.isInspectable = true
    // Safari asks the user for these; the harness grants what the manifest requests.
    for permission in ext.requestedPermissions { context.setPermissionStatus(.grantedExplicitly, for: permission) }
    for pattern in ext.allRequestedMatchPatterns { context.setPermissionStatus(.grantedExplicitly, for: pattern) }

    let controller = WKWebExtensionController(configuration: .nonPersistent())
    let browser = Browser()
    let harness = Harness()
    browser.navigationDelegate = harness
    controller.delegate = browser
    try controller.load(context)

    // ---- WhatsApp-like page: MAIN-world shim + click-time rename --------------------------
    let page = browser.makeWebView(controller)
    page.navigationDelegate = harness
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        harness.loaded = c
        page.load(URLRequest(url: URL(string: pageURL)!))
    }
    try await Task.sleep(nanoseconds: 700_000_000) // the isolated script reads storage, then configures the shim

    let patched = try await page.evaluateJavaScript("URL.__awucatPatched === true") as? Bool ?? false
    check("whatsapp-main.js runs in the page world (manifest \"world\": \"MAIN\" honoured)", patched)

    func download(_ src: String, _ name: String) async -> (String, Data?) {
        await withCheckedContinuation { (c: CheckedContinuation<(String, Data?), Never>) in
            harness.pendingDownload = c
            page.callAsyncJavaScript("await window.download(src, name); return 1;", arguments: ["src": src, "name": name], in: nil, in: .page) { _ in }
        }
    }

    var (name, data) = await download("/udf", "Gerekçeli Karar.zip")
    check("UDF blob 'Gerekçeli Karar.zip' → WebKit suggests 'Gerekçeli Karar.udf'", name.precomposedStringWithCanonicalMapping == "Gerekçeli Karar.udf", name)
    check("downloaded bytes are the original UDF (revokeObjectURL right after click is deferred)", data == fixture, "\(data?.count ?? -1) bytes")
    (name, _) = await download("/udf", "tensip.udf.zip")
    check("UDF blob 'tensip.udf.zip' → 'tensip.udf'", name == "tensip.udf", name)
    (name, _) = await download("/zip", "fotograflar.zip")
    check("ordinary zip keeps its name", name == "fotograflar.zip", name)
    (name, _) = await download("/zip", "sahte.udf.zip")
    check("non-UDF 'sahte.udf.zip' keeps its name (content wins over name)", name == "sahte.udf.zip", name)
    let notices = try await page.evaluateJavaScript("document.querySelectorAll('[data-awucat-notice]').length") as? Int ?? 0
    check("in-page notice shown instead of a system notification", notices > 0)

    // ---- extension page + handover to the app ---------------------------------------------
    let options = WKWebView(frame: NSRect(x: 0, y: 0, width: 700, height: 700), configuration: context.webViewConfiguration ?? WKWebViewConfiguration())
    options.navigationDelegate = harness
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        harness.loaded = c
        options.load(URLRequest(url: context.baseURL.appendingPathComponent("options.html")))
    }
    let apis = try await options.evaluateJavaScript("[typeof chrome.contextMenus, typeof chrome.scripting, typeof chrome.storage.session, typeof chrome.downloads, typeof chrome.notifications].join(',')") as? String ?? ""
    check("APIs: contextMenus, scripting, storage.session present; downloads, notifications absent", apis == "object,object,object,undefined,undefined", apis)
    let toggleDisabled = try await options.evaluateJavaScript("document.getElementById('fixZip').disabled") as? Bool
    check("options: .zip fix stays available (WhatsApp Web, in-page mode)", toggleDisabled == false)

    if let appURL {
        let reply = try await options.callAsyncJavaScript("""
            await chrome.storage.sync.set({ baseUrl: app });
            const timeout = new Promise((r) => setTimeout(() => r("no reply in 60 s"), 60000));
            return JSON.stringify(await Promise.race([chrome.runtime.sendMessage({ type: "awucat-ext:open-file", name: "ornek-dilekce.udf", mime: "", data: b64 }), timeout]));
            """, arguments: ["app": appURL, "b64": fixture.base64EncodedString()], in: nil, contentWorld: .page) as? String ?? "nil"
        check("popup/picker path: background opened an app tab and streamed the file to its content script", reply.contains("\"ok\":true"), reply)
        // Against `next dev` the app page can reload itself right after the first load (seen in a
        // plain WKWebView without any extension too); a file delivered before that reload is lost.
        // Use a production build (APP_URL=…) for a stable result.
        var rendered = false
        for _ in 0..<120 where !rendered {
            if let tab = browser.window.tabs.last,
               let hit = try? await tab.view.evaluateJavaScript("document.body ? (document.body.innerText || '').includes('MAHKEMES') : false") as? Bool {
                rendered = hit
            }
            if !rendered { try await Task.sleep(nanoseconds: 500_000_000) }
        }
        var detail = browser.window.tabs.last?.view.url?.absoluteString ?? "no tab"
        if !rendered, let tab = browser.window.tabs.last {
            detail += " · page log: " + ((try? await tab.view.evaluateJavaScript("JSON.stringify(window.__udfLog)") as? String) ?? "?")
        }
        check("app tab rendered the UDF (\"MAHKEMESİ\")", rendered, detail)
    } else {
        print("SKIP  handover to the app (no app URL)")
    }

    try? controller.unload(context)
    return failures == 0 ? 0 : 1
}

setvbuf(stdout, nil, _IONBF, 0)
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
Task { @MainActor in
    do {
        exit(try await run())
    } catch {
        print("ERROR: \(error)")
        exit(2)
    }
}
application.run()
