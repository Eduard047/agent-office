import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private var stdoutBuffer = Data()
    private var didLoadOffice = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureWindow()
        showLoadingState()
        startBundledServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopBundledServer()
    }

    private func configureWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Office"
        window.minSize = NSSize(width: 980, height: 650)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func showLoadingState() {
        let html = """
        <!doctype html>
        <html lang="ru">
        <meta charset="utf-8">
        <style>
          :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fbfaf7; color: #2d302a; }
          main { text-align: center; }
          .icon { width: 74px; height: 74px; margin: auto; display: grid; place-items: center; border-radius: 22px; background: #edf5e8; font-size: 34px; box-shadow: 0 12px 30px rgba(70, 78, 62, .12); }
          h1 { margin: 18px 0 7px; font-size: 25px; letter-spacing: -.03em; }
          p { margin: 0; color: #73776e; font-size: 14px; }
          .pulse { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #63a847; animation: pulse 1.2s ease-in-out infinite; }
          @keyframes pulse { 50% { opacity: .35; transform: scale(.8); } }
        </style>
        <body><main><div class="icon">🌿</div><h1>Agent Office</h1><p><span class="pulse"></span>Подключаем Codex Pro…</p></main></body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func showError(_ message: String) {
        let safeMessage = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!doctype html>
        <html lang="ru"><meta charset="utf-8">
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; box-sizing: border-box; background: #fbfaf7; color: #2d302a; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          main { max-width: 580px; padding: 28px; border: 1px solid #ead8bb; border-radius: 20px; background: #fff9ed; }
          h1 { margin: 0 0 10px; font-size: 22px; }
          p { margin: 0; color: #795f35; line-height: 1.55; }
        </style>
        <body><main><h1>Не удалось открыть офис</h1><p>\(safeMessage)</p></main></body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func startBundledServer() {
        guard let resources = Bundle.main.resourceURL else {
            showError("В приложении отсутствуют встроенные ресурсы.")
            return
        }

        let nodeURL = resources.appendingPathComponent("node")
        let serverURL = resources.appendingPathComponent("app/server/local-app-server.mjs")
        guard FileManager.default.isExecutableFile(atPath: nodeURL.path),
              FileManager.default.fileExists(atPath: serverURL.path) else {
            showError("Встроенный сервер приложения повреждён. Скачайте Agent Office заново.")
            return
        }

        let process = Process()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.executableURL = nodeURL
        process.arguments = [serverURL.path, "--port", "0"]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        var environment = ProcessInfo.processInfo.environment
        environment["AGENT_OFFICE_APP"] = "1"
        environment["NODE_ENV"] = "production"
        process.environment = environment

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async {
                self?.consumeServerOutput(data)
            }
        }

        process.terminationHandler = { [weak self] terminatedProcess in
            guard terminatedProcess.terminationStatus != 0 else { return }
            let errorData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            let errorText = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                guard self?.didLoadOffice == false else { return }
                self?.showError(errorText?.isEmpty == false ? errorText! : "Встроенный сервер завершился раньше времени.")
            }
        }

        do {
            try process.run()
            serverProcess = process
        } catch {
            showError("Не удалось запустить встроенный сервер: \(error.localizedDescription)")
        }
    }

    private func consumeServerOutput(_ data: Data) {
        stdoutBuffer.append(data)
        while let newlineRange = stdoutBuffer.firstRange(of: Data([0x0A])) {
            let lineData = stdoutBuffer.subdata(in: stdoutBuffer.startIndex..<newlineRange.lowerBound)
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex...newlineRange.lowerBound)
            guard let payload = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  payload["type"] as? String == "ready",
                  let urlString = payload["url"] as? String,
                  let url = URL(string: urlString) else {
                continue
            }
            didLoadOffice = true
            webView.load(URLRequest(url: url))
        }
    }

    private func stopBundledServer() {
        guard let process = serverProcess, process.isRunning else { return }
        process.terminate()
        serverProcess = nil
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "about" || url.host == "127.0.0.1" || url.host == "localhost" {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
