// Tracker.exe: the tracker in its own window, so it has its own taskbar icon and can be pinned.
// It shows http://127.0.0.1:4317 in WebView2. If the server isn't up, it starts the tray (desktop\start-tray.vbs),
// which runs and watches the server, and waits for it. One window per user: a second start brings it to the front.
using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Tracker;

static class Program
{
    const string ShowEventName = @"Local\TrackerAppShow";

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, @"Local\TrackerApp", out var first);
        if (!first)
        {
            try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { /* the other window is closing */ }
            return;
        }
        ApplicationConfiguration.Initialize();
        using var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        var form = new MainForm();
        var waiter = new Thread(() =>
        {
            while (show.WaitOne())
                if (!form.IsDisposed) form.BeginInvoke(form.BringToFront2);
        }) { IsBackground = true };
        waiter.Start();
        Application.Run(form);
    }
}

sealed class MainForm : Form
{
    static readonly int Port = int.TryParse(Environment.GetEnvironmentVariable("TRACKER_PORT"), out var p) ? p : 4317;
    static readonly string Url = $"http://127.0.0.1:{Port}";
    static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Tracker");
    static readonly string WindowFile = Path.Combine(DataDir, "window.txt");

    readonly WebView2 web = new() { Dock = DockStyle.Fill, Visible = false };
    readonly Panel status = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(243, 244, 246) };
    readonly Label message = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Fill, Font = new Font("Segoe UI", 11f), ForeColor = Color.FromArgb(91, 97, 110) };
    readonly Button retry = new() { Text = "Try again", AutoSize = true, Visible = false, Font = new Font("Segoe UI", 10f) };

    public MainForm()
    {
        Text = "Tracker";
        using (var s = typeof(MainForm).Assembly.GetManifestResourceStream("tracker.ico")) if (s != null) Icon = new Icon(s);
        MinimumSize = new Size(720, 480);
        RestoreBounds2();

        var bar = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 120, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(0) };
        bar.Resize += (_, _) => retry.Margin = new Padding(Math.Max(0, (bar.ClientSize.Width - retry.Width) / 2), 0, 0, 0);
        bar.Controls.Add(retry);
        status.Controls.Add(message);
        status.Controls.Add(bar);
        Controls.Add(web);
        Controls.Add(status);
        retry.Click += async (_, _) => await Connect();

        Load += async (_, _) => await Connect();
        FormClosing += (_, _) => SaveBounds();
    }

    public void BringToFront2()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
    }

    void ShowStatus(string text, bool canRetry)
    {
        message.Text = text;
        retry.Visible = canRetry;
        status.Visible = true;
        web.Visible = false;
    }

    async Task Connect()
    {
        ShowStatus("Starting the tracker…", false);
        if (!await ServerUp())
        {
            StartTray();
            var watch = Stopwatch.StartNew();
            while (!await ServerUp() && watch.Elapsed < TimeSpan.FromSeconds(45)) await Task.Delay(500);
        }
        if (!await ServerUp())
        {
            ShowStatus("The tracker server didn't start.\nSee %APPDATA%\\Tracker\\server.log.err, or run npm start in the tracker folder.", true);
            return;
        }
        try
        {
            if (web.CoreWebView2 == null)
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tracker", "WebView2"));
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2!;
                core.Settings.IsStatusBarEnabled = false;
                core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Tracker" : core.DocumentTitle;
                // Links that leave the tracker (or ask for a new window) open in the normal browser.
                core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
                core.NavigationStarting += (_, e) =>
                {
                    if (!e.Uri.StartsWith(Url, StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("about:")) { e.Cancel = true; OpenExternal(e.Uri); }
                };
                core.NavigationCompleted += (_, e) =>
                {
                    if (e.IsSuccess) { web.Visible = true; status.Visible = false; }
                    else if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) ShowStatus("Lost the connection to the tracker.", true);
                };
            }
            web.CoreWebView2!.Navigate(Url);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowStatus("This needs the Microsoft Edge WebView2 Runtime.\nInstall it from microsoft.com/edge/webview2, then try again.", true);
        }
    }

    static async Task<bool> ServerUp()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            return (await http.GetAsync($"{Url}/api/agent/status")).IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>The tray runs the server and restarts it if it stops. If the tray is already running, it owns the server.</summary>
    static void StartTray()
    {
        if (Mutex.TryOpenExisting(@"Local\TrackerTray", out var tray)) { tray.Dispose(); return; }
        var vbs = FindUp(AppContext.BaseDirectory, Path.Combine("desktop", "start-tray.vbs"));
        if (vbs == null) return;
        Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "wscript.exe"), $"\"{vbs}\"") { UseShellExecute = false });
    }

    static string? FindUp(string dir, string relative)
    {
        for (var d = new DirectoryInfo(dir); d != null; d = d.Parent)
        {
            var candidate = Path.Combine(d.FullName, relative);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    static void OpenExternal(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https" || u.Scheme == "mailto"))
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    }

    // Window size and position, as "x y width height maximized" in %APPDATA%\Tracker\window.txt.
    void RestoreBounds2()
    {
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1280, 860);
        try
        {
            var v = File.ReadAllText(WindowFile).Split(' ').Select(int.Parse).ToArray();
            var r = new Rectangle(v[0], v[1], v[2], v[3]);
            if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
                if (v[4] == 1) WindowState = FormWindowState.Maximized;
            }
        }
        catch { /* first run or unreadable: use the default */ }
    }

    void SaveBounds()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(WindowFile, $"{r.X} {r.Y} {r.Width} {r.Height} {(WindowState == FormWindowState.Maximized ? 1 : 0)}");
        }
        catch { /* not worth bothering anyone about */ }
    }
}
