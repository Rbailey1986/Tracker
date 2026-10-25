import Foundation

public enum APIError: LocalizedError {
    case invalidURL
    case networkError(Error)
    case serverError(statusCode: Int, message: String)
    case decodingError(Error)
    case invalidData

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL. Please check Settings."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .invalidData:
            return "Invalid response data from server."
        }
    }
}

public actor TrackerAPI {
    public static let shared = TrackerAPI()

    private let defaultBaseURL = "https://bailey-1.tailbcee98.ts.net:8443"
    private let urlDefaultsKey = "tracker_server_url"

    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15.0
        config.timeoutIntervalForResource = 30.0
        self.session = URLSession(configuration: config)
    }

    public func getBaseURL() -> String {
        let stored = UserDefaults.standard.string(forKey: urlDefaultsKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let stored = stored, !stored.isEmpty {
            return stored.hasSuffix("/") ? String(stored.dropLast()) : stored
        }
        return defaultBaseURL
    }

    public func setBaseURL(_ urlString: String) {
        let cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let formatted = cleaned.hasSuffix("/") ? String(cleaned.dropLast()) : cleaned
        UserDefaults.standard.set(formatted, forKey: urlDefaultsKey)
    }

    // MARK: - Generic Request Helper

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: [String: Any]? = nil
    ) async throws -> T {
        guard let url = URL(string: "\(getBaseURL())\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidData
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            throw APIError.serverError(statusCode: httpResponse.statusCode, message: msg)
        }

        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Endpoints

    public func testConnection() async throws -> (success: Bool, latencyMs: Double) {
        let start = Date()
        guard let url = URL(string: "\(getBaseURL())/api/today") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let (_, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 500
            throw APIError.serverError(statusCode: code, message: "Connection returned status \(code)")
        }
        let elapsed = Date().timeIntervalSince(start) * 1000.0
        return (true, elapsed)
    }

    public func fetchToday() async throws -> TodayResponse {
        return try await request(path: "/api/today")
    }

    public func fetchProjects(status: String? = nil) async throws -> [Project] {
        let path = status != nil ? "/api/projects?status=\(status!)" : "/api/projects"
        return try await request(path: path)
    }

    public func fetchProject(id: String) async throws -> Project {
        return try await request(path: "/api/projects/\(id)")
    }

    public func createProject(name: String, area: String, color: String, description: String) async throws -> Project {
        let payload: [String: Any] = [
            "name": name,
            "area": area,
            "color": color,
            "description": description
        ]
        return try await request(path: "/api/projects", method: "POST", body: payload)
    }

    public func fetchProjectTasks(projectId: String) async throws -> [TaskItem] {
        return try await request(path: "/api/projects/\(projectId)/tasks")
    }

    public func fetchTask(id: String) async throws -> TaskItem {
        return try await request(path: "/api/tasks/\(id)")
    }

    public func completeTask(id: String) async throws -> TaskItem {
        return try await request(path: "/api/tasks/\(id)/complete", method: "POST", body: [:])
    }

    public func reopenTask(id: String) async throws -> TaskItem {
        return try await request(path: "/api/tasks/\(id)/reopen", method: "POST", body: [:])
    }

    public func updateTask(id: String, fields: [String: Any]) async throws -> TaskItem {
        return try await request(path: "/api/tasks/\(id)", method: "PATCH", body: fields)
    }

    public func createTask(
        projectId: String,
        title: String,
        priority: TaskPriority? = nil,
        owner: TaskOwner = .you,
        dueDate: String? = nil,
        estimateMinutes: Int? = nil,
        description: String = ""
    ) async throws -> TaskItem {
        var payload: [String: Any] = [
            "project_id": projectId,
            "title": title,
            "owner": owner.rawValue,
            "description": description
        ]
        if let priority = priority {
            payload["priority"] = priority.rawValue
        }
        if let dueDate = dueDate {
            payload["due_date"] = dueDate
        }
        if let estimateMinutes = estimateMinutes {
            payload["estimate_minutes"] = estimateMinutes
        }
        return try await request(path: "/api/tasks", method: "POST", body: payload)
    }

    public func deleteTask(id: String) async throws {
        let _: [String: Bool] = try await request(path: "/api/tasks/\(id)", method: "DELETE")
    }

    public func toggleSubtask(id: String, done: Bool) async throws -> Subtask {
        return try await request(path: "/api/subtasks/\(id)", method: "PATCH", body: ["done": done])
    }

    public func createSubtask(taskId: String, text: String) async throws -> Subtask {
        return try await request(path: "/api/subtasks", method: "POST", body: ["task_id": taskId, "text": text])
    }

    public func deleteSubtask(id: String) async throws {
        let _: [String: Bool] = try await request(path: "/api/subtasks/\(id)", method: "DELETE")
    }

    public func fetchMilestones(projectId: String) async throws -> [Milestone] {
        return try await request(path: "/api/projects/\(projectId)/milestones")
    }

    public func fetchNote(parentType: String, parentId: String) async throws -> String {
        struct NoteResponse: Codable {
            let note: ProjectNote?
        }
        let res: NoteResponse = try await request(path: "/api/notes/\(parentType)/\(parentId)")
        return res.note?.body_md ?? ""
    }

    public func saveNote(parentType: String, parentId: String, body: String) async throws {
        struct NoteResponse: Codable {
            let note: ProjectNote?
        }
        let _: NoteResponse = try await request(
            path: "/api/notes/\(parentType)/\(parentId)",
            method: "PUT",
            body: ["body_md": body]
        )
    }

    public func fetchWeekly() async throws -> WeeklyResponse {
        return try await request(path: "/api/weekly")
    }

    public func answerQuestion(id: String, answer: String) async throws -> AgentQuestion {
        return try await request(path: "/api/questions/\(id)/answer", method: "POST", body: ["answer": answer])
    }

    public func backupDatabase() async throws -> Bool {
        struct BackupResponse: Codable {
            let ok: Bool
        }
        let res: BackupResponse = try await request(path: "/api/settings/backup", method: "POST", body: [:])
        return res.ok
    }

    public func fetchResumePrompt(projectId: String) async throws -> String {
        struct ResumeRes: Codable {
            let resume_prompt: String
        }
        let res: ResumeRes = try await request(path: "/api/agent/projects/\(projectId)")
        return res.resume_prompt
    }
}
