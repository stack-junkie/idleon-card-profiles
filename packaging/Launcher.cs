using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class Launcher
{
    public const string SteamGameUri = "steam://rungameid/1476970";
    // CommandLineToArgvW / Microsoft CRT quoting. Never involve cmd.exe.
    public static string Quote(string value)
    {
        StringBuilder output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); }
            else { output.Append('\\', slashes); output.Append(c); }
            slashes = 0;
        }
        output.Append('\\', slashes * 2); output.Append('"');
        return output.ToString();
    }

    public static string[] BuildArguments(string root, string[] args)
    {
        List<string> result = new List<string>();
        result.Add(Path.Combine(root, "src", "cli.js"));
        if (args.Length > 0 && args[0] == "--steam")
        {
            if (args.Length < 2 || !(args[1].StartsWith("\\\\") || (args[1].Length > 2 && args[1][1] == ':' && (args[1][2] == '\\' || args[1][2] == '/'))) ||
                !String.Equals(Path.GetFileName(args[1]), "LegendsOfIdleon.exe", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Steam must supply the full LegendsOfIdleon.exe path after --steam.");
            result.Add("steam"); result.Add("--");
            for (int i = 1; i < args.Length; i++) result.Add(args[i]);
        }
        else throw new ArgumentException("Open Card Profiles normally, or use --configure for Steam setup.");
        return result.ToArray();
    }

    public static string JoinArguments(string[] args)
    {
        string[] quoted = new string[args.Length];
        for (int i = 0; i < args.Length; i++) quoted[i] = Quote(args[i]);
        return String.Join(" ", quoted);
    }

    // Setup uses its staged runtime for preflight, with the eventual install path.
    // Read both streams asynchronously so even a verbose failure cannot deadlock.
    public static string RunSteamSetup(string runtimeRoot, string action, string installRoot)
    {
        if (action != "check" && action != "enable" && action != "disable" && action != "status") throw new ArgumentException("Unknown Steam setup action.");
        string node = Path.Combine(runtimeRoot, "runtime", "node.exe");
        string script = Path.Combine(runtimeRoot, "src", "steam-setup.js");
        if (!File.Exists(node) || !File.Exists(script)) throw new IOException("Card Profiles is incomplete. Run the latest installer to repair it.");
        using (Process child = new Process())
        {
            child.StartInfo = new ProcessStartInfo(node, JoinArguments(new string[] { script, action, Path.GetFullPath(installRoot) })) {
                WorkingDirectory = runtimeRoot, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            StringBuilder output = new StringBuilder(), errors = new StringBuilder();
            object gate = new object();
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (gate) { output.AppendLine(e.Data); if (output.Length > 3000) output.Remove(0, output.Length - 3000); } };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (gate) { errors.AppendLine(e.Data); if (errors.Length > 3000) errors.Remove(0, errors.Length - 3000); } };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            // The script bounds external discovery itself. Never terminate it during a config write.
            child.WaitForExit();
            lock (gate)
            {
                if (child.ExitCode != 0) throw new IOException(errors.Length == 0 ? "Steam setup could not finish. Exit Idleon and Steam, then try again." : errors.ToString().Trim());
                return output.ToString().Trim();
            }
        }
    }

    public static void OpenSteamGame(string root)
    {
        RunSteamSetup(root, "status", root);
        using (Process opened = Process.Start(new ProcessStartInfo(SteamGameUri) { UseShellExecute = true })) { }
    }

    [STAThread]
    public static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string root = AppDomain.CurrentDomain.BaseDirectory;
        if (args.Length == 1 && args[0] == "--configure") { Application.Run(new SteamSetup(root)); return 0; }
        string logPath = null;
        try
        {
            if (args.Length == 0) { OpenSteamGame(root); return 0; }
            string[] forwarded = BuildArguments(root, args);
            string node = Path.Combine(root, "runtime", "node.exe");
            if (!File.Exists(node) || !File.Exists(forwarded[0])) throw new IOException("Card Profiles is incomplete. Run setup again to repair it.");
            string logs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IdleonCardProfiles", "logs");
            Directory.CreateDirectory(logs);
            logPath = Path.Combine(logs, "launcher-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" + Process.GetCurrentProcess().Id + ".log");
            using (StreamWriter log = new StreamWriter(logPath, false, new UTF8Encoding(false)))
            using (Process child = new Process())
            {
                log.AutoFlush = true;
                object gate = new object();
                StringBuilder errors = new StringBuilder();
                child.StartInfo = new ProcessStartInfo(node, JoinArguments(forwarded));
                child.StartInfo.WorkingDirectory = root;
                child.StartInfo.UseShellExecute = false;
                child.StartInfo.CreateNoWindow = true;
                child.StartInfo.RedirectStandardOutput = true;
                child.StartInfo.RedirectStandardError = true;
                child.StartInfo.RedirectStandardInput = true;
                child.StartInfo.EnvironmentVariables["IDLEON_CARD_PROFILES_MANAGED"] = "1";
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (gate) { log.WriteLine(e.Data); } };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (gate) { log.WriteLine(e.Data); errors.AppendLine(e.Data); if (errors.Length > 3000) errors.Remove(0, errors.Length - 3000); }
                };
                child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                // The tray, redirected streams, and launcher live as long as the helper.
                using (HelperTray tray = new HelperTray(root, child)) { Application.Run(tray); }
                if (child.ExitCode != 0)
                {
                    string reason; lock (gate) { reason = errors.ToString().Trim(); }
                    if (reason.Length > 900) reason = reason.Substring(0, 900) + "...";
                    throw new IOException(reason.Length == 0 ? "The Card Profiles helper stopped with an error." : reason);
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (logPath != null)
            {
                // The session writer is disposed before reaching this catch. Capture
                // launcher failures too, including errors after a clean helper exit.
                try { File.AppendAllText(logPath, "\nLauncher failure:\n" + error.ToString() + "\n", new UTF8Encoding(false)); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            MessageBox.Show(error.Message + "\n\nFor setup repair, exit Idleon and Steam, then run the installer again.\n" +
                (logPath == null ? "Uninstalling Card Profiles restores your previous Steam settings." : "Details: " + logPath), "Card Profiles could not start", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}

internal sealed class HelperTray : ApplicationContext
{
    private readonly NotifyIcon icon;
    private readonly ContextMenuStrip menu;
    private readonly Control dispatcher = new Control();
    private SteamSetup settings;
    private bool resourcesDisposed;
    public HelperTray(string root, Process child) : this(root, child, true) { }
    internal HelperTray(string root, Process child, bool showTray)
    {
        IntPtr unused = dispatcher.Handle;
        menu = new ContextMenuStrip();
        ToolStripMenuItem configure = new ToolStripMenuItem("Settings");
        ToolStripMenuItem disconnect = new ToolStripMenuItem("Disconnect add-on");
        configure.Click += delegate {
            if (settings == null || settings.IsDisposed) settings = new SteamSetup(root);
            settings.Show(); settings.Activate();
        };
        disconnect.Click += delegate {
            disconnect.Enabled = false;
            try { child.StandardInput.WriteLine("disconnect"); child.StandardInput.Flush(); }
            catch (IOException) { }
            catch (InvalidOperationException) { }
        };
        menu.Items.Add(configure); menu.Items.Add(disconnect);
        icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "Card Profiles", ContextMenuStrip = menu, Visible = showTray };
        icon.DoubleClick += delegate { configure.PerformClick(); };
        Thread completion = new Thread(delegate() {
            child.WaitForExit();
            dispatcher.BeginInvoke(new Action(delegate { ExitThread(); }));
        });
        completion.IsBackground = true; completion.Start();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing && !resourcesDisposed)
        {
            resourcesDisposed = true;
            icon.Visible = false; icon.Dispose(); menu.Dispose();
            if (settings != null) settings.Dispose();
            dispatcher.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class SteamSetup : Form
{
    public SteamSetup(string root)
    {
        Text = "Card Profiles: Steam setup";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(550, 236); MinimumSize = new Size(566, 275);
        Font = SystemFonts.MessageBoxFont; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Label title = new Label { Text = "Card Profiles in Steam", Location = new Point(22, 20), AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 13, FontStyle.Bold) };
        Label steps = new Label { Text = "Exit Idleon and Steam, then click Enable / repair.\nAfter setup, open Idleon in Steam and click Play.", Location = new Point(22, 61), Size = new Size(505, 48) };
        Button enable = new Button { Text = "Enable / repair", Location = new Point(22, 121), Size = new Size(150, 30) };
        Button close = new Button { Text = "Close", DialogResult = DialogResult.OK, Location = new Point(437, 186), Size = new Size(90, 28) };
        enable.Click += delegate {
            enable.Enabled = false; close.Enabled = false; UseWaitCursor = true;
            try { Launcher.RunSteamSetup(root, "enable", root); steps.Text = "Ready. Open Idleon in Steam and click Play."; enable.Text = "Enabled"; }
            catch (Exception error) { MessageBox.Show(this, error.Message, "Steam setup could not finish", MessageBoxButtons.OK, MessageBoxIcon.Warning); enable.Enabled = true; }
            finally { close.Enabled = true; UseWaitCursor = false; }
        };
        LinkLabel details = new LinkLabel { Text = "Details", AutoSize = true, Location = new Point(22, 192) };
        details.LinkClicked += delegate { MessageBox.Show("Installation normally sets this up automatically. Use repair after switching Steam accounts or changing launch settings.\n\nSetup backs up Idleon's previous launch options. Uninstall restores them. Your game files and saved profiles stay unchanged.\n\nSteam must be fully exited while its settings are updated. Setup never closes Steam or your game for you.", "Steam setup details", MessageBoxButtons.OK, MessageBoxIcon.Information); };
        Controls.AddRange(new Control[] { title, steps, enable, details, close }); AcceptButton = enable; CancelButton = close;
    }
}
