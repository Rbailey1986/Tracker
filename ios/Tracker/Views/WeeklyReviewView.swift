import SwiftUI

public struct WeeklyReviewView: View {
    @ObservedObject var state = AppState.shared
    @State private var answeringQuestionId: String?
    @State private var answerText: String = ""
    @State private var isSubmitting: Bool = false

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let weekly = state.weeklyData {
                        // Summary Hero
                        summaryCard(weekly)

                        // Open Agent Questions
                        if !weekly.questions.isEmpty {
                            questionsSection(weekly.questions)
                        }

                        // Completed this week
                        completedSection(weekly.completed)

                        // Slipped / Overdue
                        if !weekly.slipped.isEmpty {
                            slippedSection(weekly.slipped)
                        }

                        // Quiet Projects
                        if !weekly.quiet_projects.isEmpty {
                            quietSection(weekly.quiet_projects)
                        }
                    } else if state.isLoading {
                        ProgressView("Loading weekly review...")
                            .padding(.top, 40)
                    } else if let err = state.errorMessage {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.largeTitle)
                                .foregroundColor(.orange)
                            Text("Could not load weekly review")
                                .font(.headline)
                            Text(err)
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Button("Try Again") {
                                Task { await state.refreshWeekly() }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(.top, 40)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Weekly Review")
            .refreshable {
                await state.refreshWeekly()
            }
        }
        .task {
            if state.weeklyData == nil {
                await state.refreshWeekly()
            }
        }
    }

    // MARK: - Summary Card

    @ViewBuilder
    private func summaryCard(_ w: WeeklyResponse) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Text("WEEKLY SUMMARY")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)

                Text("\(w.week_start) – \(w.week_end)")
                    .font(.title3)
                    .fontWeight(.bold)

                HStack(spacing: 16) {
                    statBox(count: w.completed.count, label: "Completed", color: .green, icon: "checkmark.circle.fill")
                    statBox(count: w.slipped.count, label: "Slipped", color: .red, icon: "clock.badge.exclamationmark.fill")
                    statBox(count: w.quiet_projects.count, label: "Quiet", color: .orange, icon: "moon.fill")
                }
                .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private func statBox(count: Int, label: String, color: Color, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundColor(color)
                Text("\(count)")
                    .font(.headline)
                    .fontWeight(.bold)
            }
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(color.opacity(0.1))
        .cornerRadius(8)
    }

    // MARK: - Questions Section

    @ViewBuilder
    private func questionsSection(_ questions: [AgentQuestion]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Questions from Agent")
                    .font(.headline)
                Spacer()
                Text("\(questions.count)")
                    .font(.caption)
                    .foregroundColor(.orange)
            }

            VStack(spacing: 12) {
                ForEach(questions) { q in
                    CardContainer {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Image(systemName: "questionmark.circle.fill")
                                    .foregroundColor(.orange)
                                if let proj = q.project_name {
                                    Text(proj)
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                }
                                Spacer()
                                Text(String(q.created_at.prefix(10)))
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }

                            Text(q.text)
                                .font(.subheadline)
                                .fontWeight(.medium)

                            if let task = q.task_title {
                                Text("On task: \(task)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }

                            // Inline answering box
                            if answeringQuestionId == q.id {
                                VStack(alignment: .trailing, spacing: 8) {
                                    TextField("Type your answer...", text: $answerText, axis: .vertical)
                                        .lineLimit(2...5)
                                        .padding(8)
                                        .background(Color(.tertiarySystemFill))
                                        .cornerRadius(8)

                                    HStack {
                                        Button("Cancel") {
                                            answeringQuestionId = nil
                                            answerText = ""
                                        }
                                        .font(.caption)

                                        Button(isSubmitting ? "Sending..." : "Submit Answer") {
                                            Task { await submitAnswer(q.id) }
                                        }
                                        .font(.caption)
                                        .buttonStyle(.borderedProminent)
                                        .disabled(answerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                                    }
                                }
                                .padding(.top, 4)
                            } else {
                                Button {
                                    answeringQuestionId = q.id
                                    answerText = ""
                                } label: {
                                    HStack {
                                        Text("Answer this question")
                                            .font(.caption)
                                            .fontWeight(.medium)
                                        Image(systemName: "arrow.turn.down.right")
                                            .font(.caption2)
                                    }
                                    .foregroundColor(.indigo)
                                    .padding(.top, 4)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Completed Tasks

    @ViewBuilder
    private func completedSection(_ tasks: [WeeklyCompletedTask]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Completed this Week (\(tasks.count))")
                .font(.headline)

            if tasks.isEmpty {
                CardContainer {
                    Text("No tasks completed yet this week.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(tasks) { task in
                        HStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(task.title)
                                    .font(.subheadline)
                                    .fontWeight(.medium)

                                HStack(spacing: 6) {
                                    Text(task.project_name)
                                        .font(.caption2)
                                        .foregroundColor(Color(hex: task.project_color) ?? .secondary)

                                    if let est = task.estimate_minutes {
                                        Text("\(est)m")
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                            Spacer()
                        }
                        .padding(12)
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                }
            }
        }
    }

    // MARK: - Slipped Tasks

    @ViewBuilder
    private func slippedSection(_ tasks: [WeeklySlippedTask]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Slipped / Overdue Tasks (\(tasks.count))")
                .font(.headline)

            VStack(spacing: 8) {
                ForEach(tasks) { task in
                    HStack(spacing: 12) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(task.title)
                                .font(.subheadline)
                                .fontWeight(.medium)

                            HStack(spacing: 6) {
                                Text(task.project_name)
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: task.project_color) ?? .secondary)
                                Text("Due: \(task.due_date)")
                                    .font(.caption2)
                                    .foregroundColor(.red)
                            }
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground))
                    .cornerRadius(12)
                }
            }
        }
    }

    // MARK: - Quiet Projects

    @ViewBuilder
    private func quietSection(_ projects: [WeeklyQuietProject]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quiet Projects (\(projects.count))")
                .font(.headline)

            VStack(spacing: 8) {
                ForEach(projects) { p in
                    CardContainer {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Circle()
                                    .fill(Color(hex: p.color) ?? .indigo)
                                    .frame(width: 8, height: 8)
                                Text(p.name)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                Spacer()
                                if let days = p.days_ago {
                                    Text("\(days) days quiet")
                                        .font(.caption2)
                                        .foregroundColor(.orange)
                                }
                            }

                            if let next = p.next_step {
                                Text("Next step: \(next.title)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    private func submitAnswer(_ questionId: String) async {
        isSubmitting = true
        let text = answerText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await TrackerAPI.shared.answerQuestion(id: questionId, answer: text)
            answeringQuestionId = nil
            answerText = ""
            state.showToast("Answer sent to agent")
            await state.refreshWeekly()
            await state.refreshToday()
        } catch {
            state.errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}
