import Foundation
import SwiftUI
import Combine

public class AppState: ObservableObject {
    public static let shared = AppState()

    @Published public var todayData: TodayResponse?
    @Published public var projects: [Project] = []
    @Published public var weeklyData: WeeklyResponse?

    @Published public var isLoading: Bool = false
    @Published public var isRefreshing: Bool = false
    @Published public var errorMessage: String?
    @Published public var toastMessage: String?

    private init() {}

    public func showToast(_ message: String) {
        DispatchQueue.main.async {
            withAnimation {
                self.toastMessage = message
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                withAnimation {
                    if self.toastMessage == message {
                        self.toastMessage = nil
                    }
                }
            }
        }
    }

    @MainActor
    public func refreshToday() async {
        do {
            self.todayData = try await TrackerAPI.shared.fetchToday()
            self.errorMessage = nil
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    public func refreshProjects() async {
        do {
            self.projects = try await TrackerAPI.shared.fetchProjects()
            self.errorMessage = nil
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    public func refreshWeekly() async {
        do {
            self.weeklyData = try await TrackerAPI.shared.fetchWeekly()
            self.errorMessage = nil
        } catch {
            self.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    public func refreshAll() async {
        self.isRefreshing = true
        async let t: () = refreshToday()
        async let p: () = refreshProjects()
        async let w: () = refreshWeekly()
        _ = await (t, p, w)
        self.isRefreshing = false
    }

    @MainActor
    public func toggleTaskCompletion(_ task: TaskItem) async {
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        do {
            if task.status == .done {
                _ = try await TrackerAPI.shared.reopenTask(id: task.id)
                showToast("Task reopened")
            } else {
                _ = try await TrackerAPI.shared.completeTask(id: task.id)
                showToast("Task completed 🎉")
            }
            await refreshToday()
            await refreshProjects()
        } catch {
            self.errorMessage = "Failed to update task: \(error.localizedDescription)"
        }
    }
}
