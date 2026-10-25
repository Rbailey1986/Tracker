import SwiftUI

public struct StatusBadge: View {
    public let status: TaskStatus

    public init(status: TaskStatus) {
        self.status = status
    }

    public var body: some View {
        HStack(spacing: 4) {
            Image(systemName: status.iconName)
                .font(.caption2)
            Text(status.title)
                .font(.caption2)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(status.color.opacity(0.15))
        .foregroundColor(status.color)
        .clipShape(Capsule())
    }
}

public struct PriorityBadge: View {
    public let priority: TaskPriority

    public init(priority: TaskPriority) {
        self.priority = priority
    }

    public var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "flag.fill")
                .font(.system(size: 8))
            Text(priority.title)
                .font(.caption2)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(priority.color.opacity(0.12))
        .foregroundColor(priority.color)
        .clipShape(Capsule())
    }
}

public struct AreaPill: View {
    public let area: String

    public init(_ area: String) {
        self.area = area
    }

    public var body: some View {
        Text(area)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundColor(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Color(.secondarySystemFill))
            .clipShape(Capsule())
    }
}

public struct ProgressBar: View {
    public let percent: Int
    public let color: Color

    public init(percent: Int, color: Color = .indigo) {
        self.percent = max(0, min(100, percent))
        self.color = color
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(.tertiarySystemFill))
                    .frame(height: 6)

                Capsule()
                    .fill(color)
                    .frame(width: geo.size.width * CGFloat(percent) / 100.0, height: 6)
            }
        }
        .frame(height: 6)
    }
}

public struct CardContainer<Content: View>: View {
    public let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .padding()
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(14)
            .shadow(color: Color.black.opacity(0.04), radius: 6, x: 0, y: 2)
    }
}

public struct ToastOverlay: View {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
            Text(message)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(Color(.systemBackground))
                .shadow(color: Color.black.opacity(0.18), radius: 10, x: 0, y: 4)
        )
        .transition(.move(edge: .top).combined(with: .opacity))
        .padding(.top, 16)
    }
}
