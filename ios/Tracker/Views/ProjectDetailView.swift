import SwiftUI
import UIKit

public struct ProjectDetailView: View {
    public let projectId: String

    @ObservedObject var state = AppState.shared
    @State private var project: Project?
    @State private var tasks: [TaskItem] = []
    @State private var milestones: [Milestone] = []
    @State private var noteBody: String = ""
    @State private var isSavingNote: Bool = false

    @State private var selectedTab: Int = 0 // 0: Tasks, 1: Milestones, 2: Notes
    @State private var taskFilter: String = "Open"
    @State private var selectedTask: TaskItem?
    @State private var showingAddTask: Bool = false
    @State private var isCopyingPrompt: Bool = false

    public init(projectId: String) {
        self.projectId = projectId
    }

    private var filteredTasks: [TaskItem] {
        tasks.filter { t in
            switch taskFilter {
            case "Open": return t.status != .done
            case "Done": return t.status == .done
            case "Agent": return t.owner == .agent
            default: return true
            }
        }
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let p = project {
                    // Project Hero Card
                    heroCard(p)

                    // Tab selector
                    Picker("Section", selection: $selectedTab) {
                        Text("Tasks (\(tasks.count))").tag(0)
                        Text("Milestones (\(milestones.count))").tag(1)
                        Text("Notes").tag(2)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)

                    // Tab Content
                    if selectedTab == 0 {
                        tasksTab(p)
                    } else if selectedTab == 1 {
                        milestonesTab()
                    } else {
                        notesTab()
                    }
                } else {
                    ProgressView("Loading project details...")
                        .padding(.top, 40)
                }
            }
            .padding(.vertical)
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await loadData()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if selectedTab == 0 {
                    Button {
                        showingAddTask = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .sheet(item: $selectedTask) { task in
            TaskDetailSheet(task: task, onSave: {
                Task { await loadData() }
            })
        }
        .sheet(isPresented: $showingAddTask) {
            if let p = project {
                AddTaskSheet(projectId: p.id, onCreated: {
                    Task { await loadData() }
                })
            }
        }
        .task {
            await loadData()
        }
    }

    // MARK: - Hero Card

    @ViewBuilder
    private func heroCard(_ p: Project) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    Circle()
                        .fill(p.uiColor)
                        .frame(width: 14, height: 14)
                        .padding(.top, 4)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(p.name)
                            .font(.title3)
                            .fontWeight(.bold)
                        if !p.area.isEmpty {
                            AreaPill(p.area)
                        }
                    }

                    Spacer()

                    Text(p.status.title)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(p.status == .active ? Color.green.opacity(0.15) : Color.secondary.opacity(0.15))
                        .foregroundColor(p.status == .active ? .green : .secondary)
                        .clipShape(Capsule())
                }

                if !p.description.isEmpty {
                    Text(p.description)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                if let progress = p.progress {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("\(progress.percent)% complete")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)
                            Spacer()
                            Text("\(progress.done)/\(progress.total) tasks")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        ProgressBar(percent: progress.percent, color: p.uiColor)
                    }
                }

                // Folder & Resume prompt buttons
                VStack(spacing: 8) {
                    if let folder = p.folder, !folder.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "folder")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(folder)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                            Spacer()
                            Button {
                                UIPasteboard.general.string = folder
                                state.showToast("Folder path copied")
                            } label: {
                                Image(systemName: "doc.on.doc")
                                    .font(.caption)
                                    .foregroundColor(.indigo)
                            }
                        }
                        .padding(8)
                        .background(Color(.tertiarySystemFill))
                        .cornerRadius(8)
                    }

                    Button {
                        Task { await copyResumePrompt() }
                    } label: {
                        HStack {
                            Image(systemName: "arrow.up.right.and.arrow.down.left.rectangle")
                            Text(isCopyingPrompt ? "Fetching prompt..." : "Resume in a new chat")
                                .fontWeight(.medium)
                            Spacer()
                            Image(systemName: "doc.on.doc.fill")
                        }
                        .font(.subheadline)
                        .foregroundColor(.indigo)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 12)
                        .background(Color.indigo.opacity(0.12))
                        .cornerRadius(8)
                    }
                    .disabled(isCopyingPrompt)
                }
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Tasks Tab

    @ViewBuilder
    private func tasksTab(_ p: Project) -> some View {
        VStack(spacing: 12) {
            // Task filter pills
            HStack(spacing: 8) {
                ForEach(["Open", "All", "Done", "Agent"], id: \.self) { filter in
                    Button {
                        taskFilter = filter
                    } label: {
                        Text(filter)
                            .font(.caption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(taskFilter == filter ? Color.primary : Color(.secondarySystemFill))
                            .foregroundColor(taskFilter == filter ? Color(.systemBackground) : .primary)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
            }
            .padding(.horizontal)

            if filteredTasks.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.title)
                        .foregroundColor(.secondary)
                    Text("No tasks matching filter")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 30)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(filteredTasks) { task in
                        taskRow(task)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    @ViewBuilder
    private func taskRow(_ task: TaskItem) -> some View {
        Button {
            selectedTask = task
        } label: {
            HStack(spacing: 12) {
                Button {
                    Task {
                        await state.toggleTaskCompletion(task)
                        await loadData()
                    }
                } label: {
                    Image(systemName: task.status == .done ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundColor(task.status == .done ? .green : .secondary)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(task.status == .done ? .secondary : .primary)
                        .strikethrough(task.status == .done)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        StatusBadge(status: task.status)

                        if let pri = task.priority {
                            PriorityBadge(priority: pri)
                        }

                        if task.owner == .agent {
                            Label("Agent", systemImage: "sparkles")
                                .font(.caption2)
                                .foregroundColor(.purple)
                        }

                        if let due = task.due_date {
                            Text(due)
                                .font(.caption2)
                                .foregroundColor(task.overdue == true ? .red : .secondary)
                        }
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Milestones Tab

    @ViewBuilder
    private func milestonesTab() -> some View {
        VStack(spacing: 12) {
            if milestones.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "flag.2.crossed")
                        .font(.title)
                        .foregroundColor(.secondary)
                    Text("No milestones yet")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 30)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(milestones) { m in
                        CardContainer {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Label(m.kind.title, systemImage: m.kind.iconName)
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundColor(.indigo)

                                    if let v = m.version_label {
                                        Text("v\(v)")
                                            .font(.caption2)
                                            .fontWeight(.bold)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.indigo.opacity(0.12))
                                            .foregroundColor(.indigo)
                                            .clipShape(Capsule())
                                    }

                                    Spacer()

                                    Text(m.status == .achieved ? "Achieved" : "Planned")
                                        .font(.caption2)
                                        .fontWeight(.semibold)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(m.status == .achieved ? Color.green.opacity(0.15) : Color.blue.opacity(0.15))
                                        .foregroundColor(m.status == .achieved ? .green : .blue)
                                        .clipShape(Capsule())
                                }

                                Text(m.title)
                                    .font(.headline)

                                if !m.description.isEmpty {
                                    Text(m.description)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }

                                if let achieved = m.achieved, !achieved.isEmpty {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("DELIVERED")
                                            .font(.system(size: 8, weight: .bold))
                                            .foregroundColor(.secondary)
                                        Text(achieved)
                                            .font(.caption)
                                            .foregroundColor(.primary)
                                    }
                                    .padding(8)
                                    .background(Color(.tertiarySystemFill))
                                    .cornerRadius(8)
                                }

                                if let date = m.achieved_on ?? m.target_date {
                                    HStack(spacing: 4) {
                                        Image(systemName: "calendar")
                                            .font(.system(size: 9))
                                        Text(m.status == .achieved ? "Achieved \(date)" : "Target: \(date)")
                                            .font(.system(size: 10))
                                    }
                                    .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Notes Tab

    @ViewBuilder
    private func notesTab() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            CardContainer {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Project Notes")
                            .font(.headline)
                        Spacer()
                        Button(isSavingNote ? "Saving..." : "Save") {
                            Task { await saveNote() }
                        }
                        .disabled(isSavingNote)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }

                    TextEditor(text: $noteBody)
                        .frame(minHeight: 280)
                        .font(.system(.body, design: .monospaced))
                }
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Actions

    private func loadData() async {
        do {
            async let p = TrackerAPI.shared.fetchProject(id: projectId)
            async let t = TrackerAPI.shared.fetchProjectTasks(projectId: projectId)
            async let m = TrackerAPI.shared.fetchMilestones(projectId: projectId)
            async let n = TrackerAPI.shared.fetchNote(parentType: "project", parentId: projectId)

            self.project = try await p
            self.tasks = try await t
            self.milestones = try await m
            self.noteBody = try await n
        } catch {
            state.errorMessage = error.localizedDescription
        }
    }

    private func saveNote() async {
        isSavingNote = true
        do {
            try await TrackerAPI.shared.saveNote(parentType: "project", parentId: projectId, body: noteBody)
            state.showToast("Note saved")
        } catch {
            state.errorMessage = error.localizedDescription
        }
        isSavingNote = false
    }

    private func copyResumePrompt() async {
        isCopyingPrompt = true
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
        do {
            let prompt = try await TrackerAPI.shared.fetchResumePrompt(projectId: projectId)
            UIPasteboard.general.string = prompt
            state.showToast("Resume prompt copied to clipboard! 📋")
        } catch {
            state.errorMessage = "Failed to fetch resume prompt: \(error.localizedDescription)"
        }
        isCopyingPrompt = false
    }
}

// MARK: - Add Task Sheet

public struct AddTaskSheet: View {
    public let projectId: String
    public var onCreated: () -> Void

    @Environment(\.dismiss) var dismiss
    @State private var title: String = ""
    @State private var priority: TaskPriority = .medium
    @State private var owner: TaskOwner = .you
    @State private var dueDate: String = ""
    @State private var hasDueDate: Bool = false
    @State private var estimateMinutes: String = "30"
    @State private var description: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    public var body: some View {
        NavigationStack {
            Form {
                Section("Task Details") {
                    TextField("Task Title", text: $title)
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section("Properties") {
                    Picker("Priority", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { pri in
                            Text(pri.title).tag(pri)
                        }
                    }

                    Picker("Owner", selection: $owner) {
                        ForEach(TaskOwner.allCases, id: \.self) { o in
                            Text(o.title).tag(o)
                        }
                    }

                    TextField("Estimate (minutes)", text: $estimateMinutes)
                        .keyboardType(.numberPad)
                }

                Section("Schedule") {
                    Toggle("Set Due Date", isOn: $hasDueDate)
                    if hasDueDate {
                        TextField("YYYY-MM-DD", text: $dueDate)
                    }
                }

                if let err = errorMessage {
                    Section {
                        Text(err).foregroundColor(.red).font(.caption)
                    }
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "Adding..." : "Add") {
                        Task { await createTask() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                }
            }
        }
    }

    private func createTask() async {
        isSubmitting = true
        errorMessage = nil
        do {
            let est = Int(estimateMinutes)
            _ = try await TrackerAPI.shared.createTask(
                projectId: projectId,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                priority: priority,
                owner: owner,
                dueDate: hasDueDate && !dueDate.isEmpty ? dueDate : nil,
                estimateMinutes: est,
                description: description.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSubmitting = false
        }
    }
}
