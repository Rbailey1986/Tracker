import SwiftUI

@main
struct TrackerApp: App {
    @StateObject private var state = AppState.shared

    var body: some Scene {
        WindowGroup {
            TabView {
                TodayView()
                    .tabItem {
                        Label("Today", systemImage: "sun.max.fill")
                    }

                ProjectsView()
                    .tabItem {
                        Label("Projects", systemImage: "folder.fill")
                    }

                WeeklyReviewView()
                    .tabItem {
                        Label("Review", systemImage: "calendar")
                    }

                SettingsView()
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
            }
            .tint(Color(hex: "#5B4BA8") ?? .indigo)
        }
    }
}
