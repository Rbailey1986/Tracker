import SwiftUI

public struct TaskDetailSheet: View {
    public let task: TaskItem
    public var onSave: (() -> Void)?

    @Environment(\.dismiss) var dismiss
    @ObservedObject var state = AppState.shared

    @State private var title: String
    @State private var description: String
    @State private var status: TaskStatus
    @State private var blockedReason: String
    @State private var priority: TaskPriority
    @State private var owner: TaskOwner
    @State private var dueDate: String
    @State private var estimateMinutes: String

    @State private var subtasks: [Subtask] = []
    @State private var newSubtaskText: String = ""

    @State private var isSaving: Bool = false
    @State private var isDeleting: Bool = false
    @State private var showingDeleteAlert: Bool = false
    @State private var errorMessage: String?

    public init(task: TaskItem, onSave: (() -> Void)? = nil) {
        self.task = task
        self.onSave = onSave
        _title = State(initialValue: task.title)
        _description = State(initialValue: task.description)
        _status = State(initialValue: task.status)
        _blockedReason = State(initialValue: task.blocked_reason ?? "")
        _priority = State(initialValue: task.priority ?? .medium)
        _owner = State(initialValue: task.owner)
        _dueDate = State(initialValue: task.due_date ?? "")
        _estimateMinutes = State(initialValue: task.estimate_minutes != nil ? "\(task.estimate_minutes!)" : "")
        _subtasks = State(initialValue: task.subtasks ?? [])
    }

    public var body: some View {
        NavigationStack {
            Form {
                // Section 1: Title & Status
                Section {
                    TextField("Task Title", text: $title)
                        .font(.headline)

                    Picker("Status", selection: $status) {
                        ForEach(TaskStatus.allCases, id: \.self) { s in
                            HStack {
                                Image(systemName: s.iconName)
                                Text(s.title)
                            }.tag(s)
                        }
                    }

                    if status == .blocked {
                        TextField("Blocked reason (why is this blocked?)", text: $blockedReason)
                            .foregroundColor(.orange)
                    }
                }

                // Section 2: Properties
                Section("Properties") {
                    Picker("Priority", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in
                            Text(p.title).tag(p)
                        }
                    }

                    Picker("Owner", selection: $owner) {
                        ForEach(TaskOwner.allCases, id: \.self) { o in
                            Text(o.title).tag(o)
                        }
                    }

                    HStack {
                        Text("Due Date")
                        Spacer()
                        TextField("YYYY-MM-DD", text: $dueDate)
                            .multilineTextAlignment(.trailing)
                    }

                    HStack {
                        Text("Estimate")
                        Spacer()
                        TextField("Minutes", text: $estimateMinutes)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                        Text("min").foregroundColor(.secondary)
                    }
                }

                // Section 3: Subtasks
                Section("Subtasks (\(subtasks.filter { $0.done }.count)/\(subtasks.count))") {
                    ForEach(subtasks) { subtask in
                        HStack {
                            Button {
                                Task { await toggleSubtask(subtask) }
                            } label: {
                                Image(systemName: subtask.done ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(subtask.done ? .green : .secondary)
                            }
                            .buttonStyle(.plain)

                            Text(subtask.text)
                                .strikethrough(subtask.done)
                                .foregroundColor(subtask.done ? .secondary : .primary)

                            Spacer()
                        }
                    }
                    .onDelete(perform: deleteSubtaskRows)

                    HStack {
                        TextField("Add subtask...", text: $newSubtaskText)
                        Button {
                            Task { await addSubtask() }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .foregroundColor(.indigo)
                        }
                        .disabled(newSubtaskText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                // Section 4: Description
                Section("Description") {
                    TextEditor(text: $description)
                        .frame(minHeight: 100)
                }

                if let err = errorMessage {
                    Section {
                        Text(err).foregroundColor(.red).font(.caption)
                    }
                }

                // Section 5: Delete Task
                Section {
                    Button(role: .destructive) {
                        showingDeleteAlert = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("Delete Task")
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Task Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving..." : "Done") {
                        Task { await saveTask() }
                    }
                    .disabled(isSaving)
                }
            }
            .alert("Delete Task?", isPresented: $showingDeleteAlert) {
                Button("Delete", role: .destructive) {
                    Task { await deleteTask() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to delete '\(task.title)'? This cannot be undone.")
            }
            .task {
                await loadFreshTask()
            }
        }
    }

    private func loadFreshTask() async {
        do {
            let fresh = try await TrackerAPI.shared.fetchTask(id: task.id)
            self.subtasks = fresh.subtasks ?? []
        } catch {
            // keep existing subtasks
        }
    }

    private func saveTask() async {
        isSaving = true
        errorMessage = nil
        do {
            var fields: [String: Any] = [
                "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                "description": description.trimmingCharacters(in: .whitespacesAndNewlines),
                "status": status.rawValue,
                "priority": priority.rawValue,
                "owner": owner.rawValue,
            ]
            if status == .blocked {
                fields["blocked_reason"] = blockedReason.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                fields["blocked_reason"] = NSNull()
            }
            if !dueDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                fields["due_date"] = dueDate.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                fields["due_date"] = NSNull()
            }
            if let est = Int(estimateMinutes) {
                fields["estimate_minutes"] = est
            } else {
                fields["estimate_minutes"] = NSNull()
            }

            _ = try await TrackerAPI.shared.updateTask(id: task.id, fields: fields)
            onSave?()
            state.showToast("Task updated")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }

    private func deleteTask() async {
        isDeleting = true
        do {
            try await TrackerAPI.shared.deleteTask(id: task.id)
            onSave?()
            state.showToast("Task deleted")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isDeleting = false
        }
    }

    private func toggleSubtask(_ subtask: Subtask) async {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        do {
            let updated = try await TrackerAPI.shared.toggleSubtask(id: subtask.id, done: !subtask.done)
            if let index = subtasks.firstIndex(where: { $0.id == subtask.id }) {
                subtasks[index] = updated
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func addSubtask() async {
        let text = newSubtaskText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        newSubtaskText = ""
        do {
            let created = try await TrackerAPI.shared.createSubtask(taskId: task.id, text: text)
            subtasks.append(created)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteSubtaskRows(at offsets: IndexSet) {
        for index in offsets {
            let subtask = subtasks[index]
            Task {
                try? await TrackerAPI.shared.deleteSubtask(id: subtask.id)
            }
        }
        subtasks.remove(atOffsets: offsets)
    }
}
