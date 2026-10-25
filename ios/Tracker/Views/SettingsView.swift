import SwiftUI

public struct SettingsView: View {
    @ObservedObject var state = AppState.shared
    @State private var serverURL: String = ""
    @State private var testStatus: String?
    @State private var testSuccess: Bool?
    @State private var isTesting: Bool = false
    @State private var isBackingUp: Bool = false

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tracker Server URL")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("https://bailey-1.tailbcee98.ts.net:8443", text: $serverURL)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }

                    Button {
                        Task { await testConnection() }
                    } label: {
                        HStack {
                            Text(isTesting ? "Testing connection..." : "Test Connection")
                            Spacer()
                            if let success = testSuccess {
                                Image(systemName: success ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundColor(success ? .green : .red)
                            }
                        }
                    }
                    .disabled(isTesting)

                    if let status = testStatus {
                        Text(status)
                            .font(.caption)
                            .foregroundColor(testSuccess == true ? .green : .red)
                    }

                    Button("Reset to Default (Tailscale)") {
                        serverURL = "https://bailey-1.tailbcee98.ts.net:8443"
                        Task {
                            await TrackerAPI.shared.setBaseURL(serverURL)
                            state.showToast("Server URL set to Tailscale default")
                        }
                    }
                    .font(.caption)
                    .foregroundColor(.indigo)
                }

                Section("Remote Operations") {
                    Button {
                        Task { await triggerBackup() }
                    } label: {
                        HStack {
                            Image(systemName: "externaldrive.badge.timemachine")
                            Text(isBackingUp ? "Backing up..." : "Back Up Database Now")
                        }
                    }
                    .disabled(isBackingUp)
                }

                Section("About Tracker iOS") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("0.1.0 (Native)")
                            .foregroundColor(.secondary)
                    }

                    HStack {
                        Text("Protocol")
                        Spacer()
                        Text("Tracker REST API v1")
                            .foregroundColor(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Connection Guide")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Text("Connect securely away from home using Tailscale (bailey-1.tailbcee98.ts.net), or using your computer's local Wi-Fi IP when on the same network.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Settings")
            .task {
                serverURL = await TrackerAPI.shared.getBaseURL()
            }
            .onChange(of: serverURL) { _, newValue in
                Task {
                    await TrackerAPI.shared.setBaseURL(newValue)
                }
            }
        }
    }

    private func testConnection() async {
        isTesting = true
        testStatus = nil
        testSuccess = nil
        await TrackerAPI.shared.setBaseURL(serverURL)

        do {
            let res = try await TrackerAPI.shared.testConnection()
            testSuccess = res.success
            testStatus = "Connected successfully! Latency: \(Int(res.latencyMs)) ms"
            await state.refreshAll()
        } catch {
            testSuccess = false
            testStatus = "Connection failed: \(error.localizedDescription)"
        }
        isTesting = false
    }

    private func triggerBackup() async {
        isBackingUp = true
        do {
            let ok = try await TrackerAPI.shared.backupDatabase()
            if ok {
                state.showToast("Database backup created successfully! 💾")
            } else {
                state.showToast("Backup failed on server")
            }
        } catch {
            state.errorMessage = "Backup failed: \(error.localizedDescription)"
        }
        isBackingUp = false
    }
}
