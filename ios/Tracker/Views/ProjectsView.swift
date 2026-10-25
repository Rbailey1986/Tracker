import SwiftUI

public struct ProjectsView: View {
    @ObservedObject var state = AppState.shared
    @State private var searchText: String = ""
    @State private var selectedArea: String = "All"
    @State private var selectedStatus: ProjectStatus = .active
    @State private var showingAddSheet: Bool = false

    public init() {}

    private var availableAreas: [String] {
        let areas = Set(state.projects.map { $0.area }.filter { !$0.isEmpty })
        return ["All"] + areas.sorted()
    }

    private var filteredProjects: [Project] {
        state.projects.filter { p in
            let matchesStatus = p.status == selectedStatus
            let matchesArea = selectedArea == "All" || p.area == selectedArea
            let matchesSearch = searchText.isEmpty ||
                p.name.localizedCaseInsensitiveContains(searchText) ||
                p.description.localizedCaseInsensitiveContains(searchText) ||
                p.area.localizedCaseInsensitiveContains(searchText)
            return matchesStatus && matchesArea && matchesSearch
        }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Status segmented picker
                    Picker("Status", selection: $selectedStatus) {
                        ForEach(ProjectStatus.allCases, id: \.self) { status in
                            Text(status.title).tag(status)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)

                    // Area horizontal pills
                    if availableAreas.count > 2 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(availableAreas, id: \.self) { area in
                                    Button {
                                        selectedArea = area
                                    } label: {
                                        Text(area)
                                            .font(.caption)
                                            .fontWeight(.medium)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .background(selectedArea == area ? Color.indigo : Color(.secondarySystemFill))
                                            .foregroundColor(selectedArea == area ? .white : .primary)
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                    }

                    // Project Cards List
                    if filteredProjects.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "folder")
                                .font(.system(size: 44))
                                .foregroundColor(.secondary)
                            Text("No projects found")
                                .font(.headline)
                            Text("Try clearing filters or adding a new project.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.top, 40)
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredProjects) { project in
                                NavigationLink(destination: ProjectDetailView(projectId: project.id)) {
                                    projectCard(project)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Projects")
            .searchable(text: $searchText, prompt: "Search projects...")
            .refreshable {
                await state.refreshProjects()
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddSheet) {
                AddProjectSheet()
            }
        }
        .task {
            if state.projects.isEmpty {
                await state.refreshProjects()
            }
        }
    }

    @ViewBuilder
    private func projectCard(_ project: Project) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Circle()
                        .fill(project.uiColor)
                        .frame(width: 10, height: 10)
                        .padding(.top, 4)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(project.name)
                            .font(.headline)
                            .foregroundColor(.primary)

                        if !project.area.isEmpty {
                            AreaPill(project.area)
                        }
                    }

                    Spacer()

                    if project.quiet == true {
                        Text("Quiet")
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.15))
                            .foregroundColor(.orange)
                            .clipShape(Capsule())
                    }
                }

                if !project.description.isEmpty {
                    Text(project.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let progress = project.progress {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("\(progress.percent)% done")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)
                            Spacer()
                            Text("\(progress.done)/\(progress.total) tasks")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        ProgressBar(percent: progress.percent, color: project.uiColor)
                    }
                }

                if let next = project.next_task {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.caption2)
                            .foregroundColor(project.uiColor)
                        Text(next.title)
                            .font(.caption2)
                            .lineLimit(1)
                            .foregroundColor(.primary)
                    }
                    .padding(.top, 2)
                }

                if let lastWorked = project.last_worked_on {
                    HStack(spacing: 4) {
                        Image(systemName: "clock")
                            .font(.system(size: 9))
                        Text("Worked on \(lastWorked)")
                            .font(.system(size: 10))
                    }
                    .foregroundColor(.secondary)
                }
            }
        }
    }
}

// MARK: - Add Project Sheet

public struct AddProjectSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var name: String = ""
    @State private var area: String = "Code"
    @State private var color: String = "#5B4BA8"
    @State private var description: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    let colorPalette = [
        "#5B4BA8", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#6B7280"
    ]

    public var body: some View {
        NavigationStack {
            Form {
                Section("Project Info") {
                    TextField("Project Name", text: $name)
                    TextField("Area (e.g. Code, Music, School)", text: $area)
                    TextField("Short description", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Theme Color") {
                    HStack(spacing: 12) {
                        ForEach(colorPalette, id: \.self) { hex in
                            Circle()
                                .fill(Color(hex: hex) ?? .indigo)
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Circle()
                                        .stroke(Color.primary, lineWidth: color == hex ? 3 : 0)
                                )
                                .onTapGesture {
                                    color = hex
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }

                if let err = errorMessage {
                    Section {
                        Text(err).foregroundColor(.red).font(.caption)
                    }
                }
            }
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "Creating..." : "Create") {
                        Task {
                            await createProject()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                }
            }
        }
    }

    private func createProject() async {
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await TrackerAPI.shared.createProject(
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                area: area.trimmingCharacters(in: .whitespacesAndNewlines),
                color: color,
                description: description.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            await AppState.shared.refreshProjects()
            AppState.shared.showToast("Project created 🎉")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSubmitting = false
        }
    }
}
