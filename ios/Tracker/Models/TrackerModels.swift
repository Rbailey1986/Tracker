import Foundation
import SwiftUI

// MARK: - Enums

public enum ProjectStatus: String, Codable, CaseIterable {
    case active = "active"
    case paused = "paused"
    case archived = "archived"

    public var title: String {
        switch self {
        case .active: return "Active"
        case .paused: return "Paused"
        case .archived: return "Archived"
        }
    }
}

public enum TaskStatus: String, Codable, CaseIterable {
    case notStarted = "not_started"
    case inProgress = "in_progress"
    case blocked = "blocked"
    case done = "done"

    public var title: String {
        switch self {
        case .notStarted: return "Not Started"
        case .inProgress: return "In Progress"
        case .blocked: return "Blocked"
        case .done: return "Done"
        }
    }

    public var iconName: String {
        switch self {
        case .notStarted: return "circle"
        case .inProgress: return "arrow.triangle.2.circlepath.circle"
        case .blocked: return "exclamationmark.octagon.fill"
        case .done: return "checkmark.circle.fill"
        }
    }

    public var color: Color {
        switch self {
        case .notStarted: return .secondary
        case .inProgress: return .blue
        case .blocked: return .orange
        case .done: return .green
        }
    }
}

public enum TaskOwner: String, Codable, CaseIterable {
    case you = "you"
    case agent = "agent"

    public var title: String {
        switch self {
        case .you: return "You"
        case .agent: return "Agent"
        }
    }

    public var iconName: String {
        switch self {
        case .you: return "person.fill"
        case .agent: return "sparkles"
        }
    }
}

public enum TaskPriority: String, Codable, CaseIterable {
    case low = "low"
    case medium = "medium"
    case high = "high"

    public var title: String {
        switch self {
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        }
    }

    public var color: Color {
        switch self {
        case .low: return .secondary
        case .medium: return .blue
        case .high: return .red
        }
    }
}

public enum MilestoneKind: String, Codable, CaseIterable {
    case release = "release"
    case feature = "feature"
    case change = "change"

    public var title: String {
        switch self {
        case .release: return "Release"
        case .feature: return "Feature"
        case .change: return "Change"
        }
    }

    public var iconName: String {
        switch self {
        case .release: return "shippingbox.fill"
        case .feature: return "star.fill"
        case .change: return "arrow.triangle.branch"
        }
    }
}

public enum MilestoneStatus: String, Codable, CaseIterable {
    case planned = "planned"
    case achieved = "achieved"
}

// MARK: - Core Entities

public struct ProjectProgress: Codable, Hashable {
    public let done: Int
    public let total: Int
    public let percent: Int

    public init(done: Int = 0, total: Int = 0, percent: Int = 0) {
        self.done = done
        self.total = total
        self.percent = percent
    }
}

public struct ProjectTimeStats: Codable, Hashable {
    public let total_estimate_minutes: Int?
    public let done_estimate_minutes: Int?
    public let open_estimate_minutes: Int?
    public let logged_minutes: Int?
    public let diff_minutes: Int?
    public let session_count: Int?
    public let last_worked_on: String?
    public let quiet: Bool?
    public let days_ago: Int?
}

public struct NextTaskRef: Codable, Hashable {
    public let id: String
    public let title: String
    public let due_date: String?
}

public struct Project: Codable, Identifiable, Hashable {
    public let id: String
    public var key: String?
    public var name: String
    public var status: ProjectStatus
    public var area: String
    public var color: String
    public var description: String
    public var folder: String?
    public var version: Int?
    public var progress: ProjectProgress?
    public var blocked_count: Int?
    public var overdue_count: Int?
    public var pending_agent_files: Int?
    public var next_task: NextTaskRef?
    public var last_worked_on: String?
    public var quiet: Bool?
    public var days_ago: Int?
    public var time_stats: ProjectTimeStats?

    public var uiColor: Color {
        Color(hex: color) ?? .indigo
    }
}

public struct Subtask: Codable, Identifiable, Hashable {
    public let id: String
    public var task_id: String
    public var text: String
    public var done: Bool
    public var sort_order: Int?
    public var version: Int?
}

public struct TaskItem: Codable, Identifiable, Hashable {
    public let id: String
    public var key: String?
    public var project_id: String
    public var title: String
    public var description: String
    public var status: TaskStatus
    public var blocked: Bool?
    public var blocked_reason: String?
    public var owner: TaskOwner
    public var due_date: String?
    public var overdue: Bool?
    public var priority: TaskPriority?
    public var estimate_minutes: Int?
    public var sort_order: Int?
    public var project_name: String?
    public var project_color: String?
    public var completed_at: String?
    public var subtasks: [Subtask]?
    public var version: Int?

    public var projectUIColor: Color {
        guard let hex = project_color else { return .secondary }
        return Color(hex: hex) ?? .secondary
    }
}

public struct Milestone: Codable, Identifiable, Hashable {
    public let id: String
    public var project_id: String
    public var key: String?
    public var title: String
    public var kind: MilestoneKind
    public var version_label: String?
    public var status: MilestoneStatus
    public var target_date: String?
    public var achieved_on: String?
    public var description: String
    public var achieved: String?
    public var version: Int?
}

public struct ProjectNote: Codable {
    public let id: String?
    public let parent_type: String
    public let parent_id: String
    public var body_md: String
    public let version: Int?
}

public struct AgentQuestion: Codable, Identifiable, Hashable {
    public let id: String
    public let question_key: String?
    public let text: String
    public var status: String
    public var answer: String?
    public var answered_at: String?
    public let project_id: String?
    public let project_name: String?
    public let task_id: String?
    public let task_title: String?
    public let created_at: String
}

public struct HandoffItem: Codable, Identifiable, Hashable {
    public var id: String { message_id }
    public let message_id: String
    public let task_id: String
    public let task_title: String
    public let project_id: String?
    public let project_name: String?
    public let project_color: String?
    public let text: String
    public let status: String
    public let sent_at: String
    public let handled_at: String?
    public let reply: String?
}

public struct DayBucket: Codable, Hashable {
    public let date: String
    public let tasks: [TaskItem]
}

public struct NextStepEntry: Codable, Hashable {
    public struct MiniProject: Codable, Hashable {
        public let id: String
        public let name: String
        public let color: String
        public let area: String
        public let progress: ProjectProgress?
        public let quiet: Bool?
        public let last_worked_on: String?
    }
    public let project: MiniProject
    public let task: TaskItem?
}

public struct TodayResponse: Codable {
    public let today: String
    public let overdue: [TaskItem]
    public let due_today: [TaskItem]
    public let next_steps: [NextStepEntry]
    public let blocked: [TaskItem]
    public let with_agent: [HandoffItem]
    public let done_today: [TaskItem]
    public let week: [DayBucket]
    public let week_start: String
    public let done_this_week: Int
    public let pending_files: Int
    public let open_questions: Int
}

public struct WeeklyCompletedTask: Codable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let project_id: String
    public let project_name: String
    public let project_color: String
    public let completed_at: String
    public let owner: String
    public let estimate_minutes: Int?
}

public struct WeeklySlippedTask: Codable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let project_id: String
    public let project_name: String
    public let project_color: String
    public let due_date: String
    public let overdue: Bool
    public let priority: String?
    public let owner: String
    public let blocked: Bool
    public let blocked_reason: String?
}

public struct WeeklyQuietProject: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let color: String
    public let area: String
    public let last_worked_on: String?
    public let days_ago: Int?
    public let open_tasks_count: Int
    public let next_step: NextTaskRef?
}

public struct WeeklyResponse: Codable {
    public let today: String
    public let week_start: String
    public let week_end: String
    public let completed: [WeeklyCompletedTask]
    public let slipped: [WeeklySlippedTask]
    public let quiet_projects: [WeeklyQuietProject]
    public let questions: [AgentQuestion]
}

// MARK: - Color Hex Extension

extension Color {
    public init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }

        let r, g, b, a: Double
        if hexSanitized.count == 6 {
            r = Double((rgb & 0xFF0000) >> 16) / 255.0
            g = Double((rgb & 0x00FF00) >> 8) / 255.0
            b = Double(rgb & 0x0000FF) / 255.0
            a = 1.0
        } else if hexSanitized.count == 8 {
            r = Double((rgb & 0xFF000000) >> 24) / 255.0
            g = Double((rgb & 0x00FF0000) >> 16) / 255.0
            b = Double((rgb & 0x0000FF00) >> 8) / 255.0
            a = Double(rgb & 0x000000FF) / 255.0
        } else {
            return nil
        }

        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
