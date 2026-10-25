import SwiftUI

public struct TodayView: View {
    @ObservedObject var state = AppState.shared
    @State private var selectedTask: TaskItem?
    @State private var answeringQuestion: AgentQuestion?
    @State private var questionAnswerText: String = ""
    @State private var isSubmittingAnswer: Bool = false

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let today = state.todayData {
                        // Greeting and Progress Ring
                        headerCard(today)

                        // Focus List
                        focusSection(today)

                        // Projects Quick Strip
                        if !today.next_steps.isEmpty {
                            projectsStrip(today)
                        }

                        // Waiting for You
                        if today.open_questions > 0 || (today.pending_files > 0) {
                            waitingSection(today)
                        }

                        // With the Agent
                        if !today.with_agent.isEmpty {
                            withAgentSection(today.with_agent)
                        }

                        // Blocked
                        if !today.blocked.isEmpty {
                            blockedSection(today.blocked)
                        }

                        // Done Today
                        if !today.done_today.isEmpty {
                            doneTodaySection(today.done_today)
                        }
                    } else if state.isLoading {
                        ProgressView("Loading today's focus...")
                            .padding(.top, 40)
                    } else if let error = state.errorMessage {
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text("Could not reach tracker")
                                .font(.headline)
                            Text(error)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                            Button("Try Again") {
                                Task { await state.refreshToday() }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(.top, 60)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Today")
            .refreshable {
                await state.refreshAll()
            }
            .sheet(item: $selectedTask) { task in
                TaskDetailSheet(task: task)
            }
            .sheet(item: $answeringQuestion) { q in
                answerQuestionSheet(q)
            }
            .overlay(alignment: .top) {
                if let msg = state.toastMessage {
                    ToastOverlay(msg)
                }
            }
        }
        .task {
            if state.todayData == nil {
                await state.refreshToday()
            }
        }
    }

    // MARK: - Header & Stats Ring

    @ViewBuilder
    private func headerCard(_ data: TodayResponse) -> some View {
        CardContainer {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(formattedDate(data.today))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Text("Focus on what matters")
                        .font(.title2)
                        .fontWeight(.bold)

                    HStack(spacing: 12) {
                        Label("\(data.done_this_week) done this week", systemImage: "sparkles")
                            .font(.caption)
                            .foregroundColor(.indigo)
                        if !data.overdue.isEmpty {
                            Label("\(data.overdue.count) overdue", systemImage: "clock.badge.exclamationmark.fill")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                    .padding(.top, 4)
                }

                Spacer()

                // Small progress circle for today
                let doneCount = data.done_today.count
                let totalToday = doneCount + data.due_today.count
                let progress = totalToday > 0 ? Double(doneCount) / Double(totalToday) : 1.0

                ZStack {
                    Circle()
                        .stroke(Color(.tertiarySystemFill), lineWidth: 6)
                    Circle()
                        .trim(from: 0, to: CGFloat(progress))
                        .stroke(Color.green, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("\(doneCount)")
                            .font(.title3)
                            .fontWeight(.bold)
                        Text("done")
                            .font(.system(size: 9))
                            .foregroundColor(.secondary)
                    }
                }
                .frame(width: 58, height: 58)
            }
        }
    }

    // MARK: - Focus List

    @ViewBuilder
    private func focusSection(_ data: TodayResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Focus List")
                    .font(.headline)
                Spacer()
                Text("\(data.overdue.count + data.due_today.count) items")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            let focusTasks = (data.overdue + data.due_today)
            if focusTasks.isEmpty {
                CardContainer {
                    HStack {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(.green)
                            .font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("All caught up for today!")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text("No overdue or due tasks right now.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                    }
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(focusTasks) { task in
                        taskRow(task)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func taskRow(_ task: TaskItem) -> some View {
        Button {
            selectedTask = task
        } label: {
            HStack(spacing: 12) {
                // Checkbox
                Button {
                    Task { await state.toggleTaskCompletion(task) }
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
                        if let proj = task.project_name {
                            Text(proj)
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(task.projectUIColor)
                        }

                        if let pri = task.priority {
                            PriorityBadge(priority: pri)
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
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Projects Strip

    @ViewBuilder
    private func projectsStrip(_ data: TodayResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Active Projects")
                .font(.headline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(data.next_steps, id: \.project.id) { entry in
                        NavigationLink(destination: ProjectDetailView(projectId: entry.project.id)) {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Circle()
                                        .fill(Color(hex: entry.project.color) ?? .indigo)
                                        .frame(width: 8, height: 8)
                                    Text(entry.project.name)
                                        .font(.subheadline)
                                        .fontWeight(.semibold)
                                        .foregroundColor(.primary)
                                        .lineLimit(1)
                                    Spacer()
                                    AreaPill(entry.project.area)
                                }

                                if let p = entry.project.progress {
                                    ProgressBar(percent: p.percent, color: Color(hex: entry.project.color) ?? .indigo)
                                }

                                if let task = entry.task {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("NEXT STEP")
                                            .font(.system(size: 8, weight: .bold))
                                            .foregroundColor(.secondary)
                                        Text(task.title)
                                            .font(.caption2)
                                            .foregroundColor(.primary)
                                            .lineLimit(2)
                                    }
                                } else {
                                    Text("No next step")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .padding(12)
                            .frame(width: 200, height: 110, alignment: .topLeading)
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(12)
                            .shadow(color: Color.black.opacity(0.03), radius: 4, x: 0, y: 1)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Waiting for you

    @ViewBuilder
    private func waitingSection(_ data: TodayResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Waiting for You")
                    .font(.headline)
                Spacer()
                Text("\(data.open_questions) open questions")
                    .font(.caption)
                    .foregroundColor(.orange)
            }

            CardContainer {
                VStack(spacing: 12) {
                    HStack {
                        Image(systemName: "questionmark.bubble.fill")
                            .foregroundColor(.orange)
                        Text("The agent has asked for your input")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Spacer()
                    }

                    Text("Answer questions directly so the agent can continue work.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    NavigationLink(destination: WeeklyReviewView()) {
                        HStack {
                            Text("Open Weekly Review & Questions")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                        .padding(.vertical, 8)
                        .padding(.horizontal, 12)
                        .background(Color.orange.opacity(0.15))
                        .foregroundColor(.orange)
                        .cornerRadius(8)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - With Agent

    @ViewBuilder
    private func withAgentSection(_ handoffs: [HandoffItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("With the Agent")
                .font(.headline)

            VStack(spacing: 8) {
                ForEach(handoffs) { h in
                    CardContainer {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Label("Do Next", systemImage: "sparkles")
                                    .font(.caption2)
                                    .fontWeight(.bold)
                                    .foregroundColor(.purple)
                                Spacer()
                                Text(h.status.uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(h.status == "open" ? .orange : .green)
                            }

                            Text(h.task_title)
                                .font(.subheadline)
                                .fontWeight(.semibold)

                            if let reply = h.reply {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Agent reply:")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                    Text(reply)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                        .padding(8)
                                        .background(Color(.tertiarySystemFill))
                                        .cornerRadius(6)
                                }
                                .padding(.top, 2)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Blocked

    @ViewBuilder
    private func blockedSection(_ tasks: [TaskItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Blocked Work")
                .font(.headline)

            VStack(spacing: 8) {
                ForEach(tasks) { task in
                    Button {
                        selectedTask = task
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "exclamationmark.octagon.fill")
                                .foregroundColor(.orange)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                if let reason = task.blocked_reason {
                                    Text(reason)
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding()
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Done Today

    @ViewBuilder
    private func doneTodaySection(_ tasks: [TaskItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Done Today")
                .font(.headline)

            VStack(spacing: 8) {
                ForEach(tasks) { task in
                    taskRow(task)
                }
            }
        }
    }

    // MARK: - Answer Question Sheet

    @ViewBuilder
    private func answerQuestionSheet(_ q: AgentQuestion) -> some View {
        NavigationStack {
            Form {
                Section("Question") {
                    Text(q.text)
                        .font(.body)
                }

                Section("Your Answer") {
                    TextEditor(text: $questionAnswerText)
                        .frame(minHeight: 120)
                }
            }
            .navigationTitle("Answer Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { answeringQuestion = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmittingAnswer ? "Sending..." : "Submit") {
                        Task {
                            isSubmittingAnswer = true
                            _ = try? await TrackerAPI.shared.answerQuestion(id: q.id, answer: questionAnswerText)
                            isSubmittingAnswer = false
                            answeringQuestion = nil
                            await state.refreshToday()
                            state.showToast("Answer sent to agent")
                        }
                    }
                    .disabled(questionAnswerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmittingAnswer)
                }
            }
        }
    }

    private func formattedDate(_ iso: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        if let d = formatter.date(from: iso) {
            let out = DateFormatter()
            out.dateStyle = .full
            return out.string(from: d)
        }
        return iso
    }
}
