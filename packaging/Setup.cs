using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class PayloadManifest
{
    public string product { get; set; }
    public string version { get; set; }
    public List<PayloadFile> files { get; set; }
}
public sealed class PayloadFile
{
    public string path { get; set; }
    public long size { get; set; }
    public string sha256 { get; set; }
}

public static class Setup
{
    public const string Product = "IdleonCardProfiles";
    public static string InstallRoot { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product); } }
    public static string DataRoot { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product); } }

    [STAThread]
    public static int Main(string[] args)
    {
        bool extractOnly = args.Length > 0 && args[0] == "--extract-only";
        try
        {
            if (extractOnly)
            {
                if (args.Length != 2 || !Path.IsPathRooted(args[1])) throw new ArgumentException("Supply one absolute, empty test directory after --extract-only.");
                using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) { Extract(payload, args[1]); }
                return 0;
            }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length == 1 && (args[0] == "--uninstall" || args[0] == "--uninstall-worker"))
            {
                if (args[0] == "--uninstall")
                {
                    string copy = Path.Combine(Path.GetTempPath(), "IdleonCardProfiles-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                    File.Copy(Assembly.GetExecutingAssembly().Location, copy, false);
                    Process.Start(new ProcessStartInfo(copy, "--uninstall-worker") { UseShellExecute = false });
                    return 0;
                }
                Application.Run(new UninstallForm()); return 0;
            }
            if (args.Length != 0) throw new ArgumentException("Unknown setup option.");
            Application.Run(new InstallForm()); return 0;
        }
        catch (Exception error)
        {
            if (!extractOnly) MessageBox.Show(error.Message, "Card Profiles setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }

    public static void RejectReparsePoints(string path)
    {
        DirectoryInfo current = new DirectoryInfo(Path.GetFullPath(path));
        while (current != null)
        {
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Setup cannot use a linked folder: " + current.FullName);
            current = current.Parent;
        }
    }

    public static string SafeFile(string root, string relative)
    {
        if (String.IsNullOrEmpty(relative) || relative.IndexOf('\\') >= 0 || relative.IndexOf(':') >= 0 || Path.IsPathRooted(relative)) throw new IOException("Invalid package path.");
        string[] parts = relative.Split('/');
        foreach (string part in parts)
        {
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new IOException("Unsafe package path.");
            string device = part.Split('.')[0].ToUpperInvariant();
            if (device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" ||
                (device.Length == 4 && (device.StartsWith("COM") || device.StartsWith("LPT")) && device[3] >= '0' && device[3] <= '9')) throw new IOException("Reserved package path.");
        }
        string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string result = Path.GetFullPath(Path.Combine(prefix, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!result.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Package path escapes its destination.");
        return result;
    }

    private static string Hash(Stream stream)
    {
        using (SHA256 sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    }

    // Validate the whole package before writing. Extraction only creates files in an empty destination.
    public static void Extract(Stream payload, string destination)
    {
        if (payload == null) throw new IOException("The setup package is missing.");
        destination = Path.GetFullPath(destination); RejectReparsePoints(destination);
        if (File.Exists(destination) || (Directory.Exists(destination) && Directory.GetFileSystemEntries(destination).Length != 0)) throw new IOException("Extraction requires an empty destination.");
        using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            Dictionary<string, ZipArchiveEntry> entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                SafeFile(destination, entry.FullName);
                if (entries.ContainsKey(entry.FullName)) throw new IOException("Duplicate package entry.");
                // Reject Unix symlinks and DOS reparse-point attributes.
                if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (entry.ExternalAttributes & 0x400) != 0) throw new IOException("Linked package entries are not supported.");
                entries.Add(entry.FullName, entry);
            }
            ZipArchiveEntry manifestEntry;
            if (!entries.TryGetValue("manifest.json", out manifestEntry) || manifestEntry.Length > 1048576) throw new IOException("Package manifest is missing or too large.");
            PayloadManifest manifest;
            using (StreamReader reader = new StreamReader(manifestEntry.Open(), Encoding.UTF8)) { manifest = new JavaScriptSerializer().Deserialize<PayloadManifest>(reader.ReadToEnd()); }
            if (manifest == null || manifest.product != Product || String.IsNullOrEmpty(manifest.version) || manifest.files == null || manifest.files.Count == 0 || manifest.files.Count > 1000) throw new IOException("Invalid package manifest.");
            HashSet<string> expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase); expected.Add("manifest.json");
            long total = 0;
            foreach (PayloadFile file in manifest.files)
            {
                SafeFile(destination, file.path);
                if (!expected.Add(file.path)) throw new IOException("Duplicate manifest entry.");
                ZipArchiveEntry entry;
                if (!entries.TryGetValue(file.path, out entry) || file.size < 0 || file.size > 250000000 || entry.Length != file.size) throw new IOException("Package file is missing or has an invalid size: " + file.path);
                total += file.size; if (total > 500000000) throw new IOException("Package is too large.");
                using (Stream bytes = entry.Open()) { if (!String.Equals(Hash(bytes), file.sha256, StringComparison.OrdinalIgnoreCase)) throw new IOException("Package checksum failed: " + file.path); }
            }
            if (entries.Count != expected.Count) throw new IOException("Package contains unlisted files.");
            Directory.CreateDirectory(destination);
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string target = SafeFile(destination, entry.FullName); RejectReparsePoints(Path.GetDirectoryName(target));
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream input = entry.Open()) using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { input.CopyTo(output); }
            }
        }
    }

    private static void RequireOwnedRoot()
    {
        RejectReparsePoints(InstallRoot);
        string marker = Path.Combine(InstallRoot, "manifest.json");
        if (!File.Exists(marker)) throw new IOException("This folder is not a recognized Card Profiles installation.");
        PayloadManifest manifest = new JavaScriptSerializer().Deserialize<PayloadManifest>(File.ReadAllText(marker));
        if (manifest == null || manifest.product != Product) throw new IOException("The existing folder belongs to another application.");
    }

    private static void RequireIdle()
    {
        string prefix = InstallRoot.TrimEnd('\\') + "\\";
        // Only probe our own executable files, without writing a byte. Running images
        // cannot be opened for exclusive write access, even if process inspection fails.
        foreach (string ownFile in new string[] { Path.Combine(InstallRoot, "runtime", "node.exe"), Path.Combine(InstallRoot, "IdleonCardProfiles.exe") })
        {
            if (!File.Exists(ownFile)) continue;
            try { using (FileStream probe = new FileStream(ownFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
            catch (IOException) { throw new IOException("Card Profiles is running or its files are busy. Exit it normally, then try again."); }
        }
        foreach (Process process in Process.GetProcesses())
        {
            using (process)
            {
                if (process.Id == Process.GetCurrentProcess().Id) continue;
                string name;
                try { name = process.ProcessName; } catch (InvalidOperationException) { continue; }
                if (String.Equals(name, "LegendsOfIdleon", StringComparison.OrdinalIgnoreCase)) throw new IOException("Exit Idleon normally before installing, repairing, or uninstalling.");
                if (String.Equals(name, "steam", StringComparison.OrdinalIgnoreCase)) throw new IOException("Exit Steam using Steam > Exit, then try again. Closing only its window keeps Steam running.");
                if (!String.Equals(name, "node", StringComparison.OrdinalIgnoreCase) && !String.Equals(name, "IdleonCardProfiles", StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    string exe = process.MainModule.FileName;
                    if (exe.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Card Profiles is running. Exit its game or setup window normally, then try again.");
                }
                catch (System.ComponentModel.Win32Exception) { /* Unrelated elevated processes need not block setup. Own files were checked above. */ }
                catch (InvalidOperationException) { }
            }
        }
    }

    public static void Install()
    {
        RejectReparsePoints(InstallRoot); RequireIdle();
        if (Directory.Exists(InstallRoot)) RequireOwnedRoot();
        string parent = Path.GetDirectoryName(InstallRoot); Directory.CreateDirectory(parent);
        string staged = Path.Combine(parent, ".IdleonCardProfiles-stage-" + Guid.NewGuid().ToString("N"));
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) { Extract(payload, staged); }
        Launcher.RunSteamSetup(staged, "check", InstallRoot);
        // Check again after extraction, before touching an existing installation.
        RequireIdle();
        string previous = null;
        if (Directory.Exists(InstallRoot)) { previous = InstallRoot + ".previous-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6); Directory.Move(InstallRoot, previous); }
        try { Directory.Move(staged, InstallRoot); }
        catch { if (previous != null && !Directory.Exists(InstallRoot)) Directory.Move(previous, InstallRoot); throw; }
        Links(false); Registration(false);
        Launcher.RunSteamSetup(InstallRoot, "enable", InstallRoot);
    }

    private static void Registration(bool remove)
    {
        const string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\IdleonCardProfiles";
        using (Microsoft.Win32.RegistryKey existing = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(keyPath))
        {
            if (existing != null && !String.Equals(existing.GetValue("InstallLocation") as string, InstallRoot, StringComparison.OrdinalIgnoreCase)) throw new IOException("An unrelated uninstall registration uses the Card Profiles name.");
        }
        if (remove) { Microsoft.Win32.Registry.CurrentUser.DeleteSubKey(keyPath, false); return; }
        PayloadManifest manifest = new JavaScriptSerializer().Deserialize<PayloadManifest>(File.ReadAllText(Path.Combine(InstallRoot, "manifest.json")));
        using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(keyPath))
        {
            key.SetValue("DisplayName", "Idleon Card Profiles"); key.SetValue("DisplayVersion", manifest.version);
            key.SetValue("InstallLocation", InstallRoot); key.SetValue("DisplayIcon", Path.Combine(InstallRoot, "IdleonCardProfiles.exe"));
            key.SetValue("UninstallString", Launcher.Quote(Path.Combine(InstallRoot, "Uninstall.exe")) + " --uninstall");
            key.SetValue("NoModify", 1, Microsoft.Win32.RegistryValueKind.DWord); key.SetValue("NoRepair", 1, Microsoft.Win32.RegistryValueKind.DWord);
        }
    }

    private static void Link(string path, string target, string args, bool remove)
    {
        RejectReparsePoints(Path.GetDirectoryName(path));
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        try
        {
            if (remove && !File.Exists(path)) return;
            dynamic shortcut = shell.CreateShortcut(path);
            try
            {
                if (remove)
                {
                    string existing = shortcut.TargetPath;
                    if (String.Equals(existing, target, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
                }
                else
                {
                    if (File.Exists(path) && !String.Equals((string)shortcut.TargetPath, target, StringComparison.OrdinalIgnoreCase)) throw new IOException("An unrelated shortcut already exists: " + path);
                    shortcut.TargetPath = target; shortcut.Arguments = args; shortcut.WorkingDirectory = InstallRoot;
                    shortcut.Description = "Idleon Card Profiles"; shortcut.Save();
                }
            }
            finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut); }
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    }

    private static void Links(bool remove)
    {
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Idleon Card Profiles");
        RejectReparsePoints(menu);
        if (!remove) Directory.CreateDirectory(menu);
        string launcher = Path.Combine(InstallRoot, "IdleonCardProfiles.exe");
        Link(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Idleon Card Profiles.lnk"), launcher, "", remove);
        Link(Path.Combine(menu, "Idleon Card Profiles.lnk"), launcher, "", remove);
        Link(Path.Combine(menu, "Steam Setup.lnk"), launcher, "--configure", remove);
        Link(Path.Combine(menu, "Uninstall.lnk"), Path.Combine(InstallRoot, "Uninstall.exe"), "--uninstall", remove);
        if (remove && Directory.Exists(menu) && Directory.GetFileSystemEntries(menu).Length == 0) Directory.Delete(menu);
    }

    public static string Uninstall()
    {
        RequireOwnedRoot(); RequireIdle();
        Launcher.RunSteamSetup(InstallRoot, "disable", InstallRoot);
        string retained = InstallRoot + ".uninstalled-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
        Directory.Move(InstallRoot, retained);
        try { Links(true); Registration(true); }
        catch { Directory.Move(retained, InstallRoot); throw; }
        return retained;
    }
}

internal sealed class InstallForm : Form
{
    public InstallForm()
    {
        Text = "Install Idleon Card Profiles"; ClientSize = new Size(540, 226); StartPosition = FormStartPosition.CenterScreen;
        Font = SystemFonts.MessageBoxFont; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Label title = new Label { Text = "Idleon Card Profiles", Location = new Point(22, 22), AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 15, FontStyle.Bold) };
        Label description = new Label { Text = "Name your card presets and save groups of card setups.\n\nExit Idleon and Steam before installing. Setup adds Card Profiles to Steam's normal Play button.", Location = new Point(22, 63), Size = new Size(492, 75) };
        LinkLabel details = new LinkLabel { Text = "Installation details", AutoSize = true, Location = new Point(22, 143) };
        details.LinkClicked += delegate { MessageBox.Show("Everything needed is included. No administrator access or separate software installation is needed.\n\nInstall location:\n" + Setup.InstallRoot + "\n\nSetup enables Card Profiles for the most recently used Steam account and backs up Idleon's previous launch options. Uninstall restores those settings.\n\nYour saved profiles are kept during updates. Installed game files stay unchanged.\n\nTo fully exit Steam, choose Steam > Exit. Setup never closes Steam or your game for you.", "Installation details", MessageBoxButtons.OK, MessageBoxIcon.Information); };
        Button install = new Button { Text = Directory.Exists(Setup.InstallRoot) ? "Repair / update" : "Install", Location = new Point(319, 176), Size = new Size(112, 30) };
        Button cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Location = new Point(440, 176), Size = new Size(78, 30) };
        install.Click += delegate {
            install.Enabled = false; cancel.Enabled = false; UseWaitCursor = true;
            try { Setup.Install(); UseWaitCursor = false; Hide(); using (InstalledForm ready = new InstalledForm(Setup.InstallRoot)) { ready.ShowDialog(); } Close(); }
            catch (Exception error) { MessageBox.Show(error.Message, "Setup could not finish", MessageBoxButtons.OK, MessageBoxIcon.Warning); install.Enabled = true; cancel.Enabled = true; }
            finally { UseWaitCursor = false; }
        };
        Controls.AddRange(new Control[] { title, description, details, install, cancel }); AcceptButton = install; CancelButton = cancel;
    }
}

internal sealed class InstalledForm : Form
{
    public InstalledForm(string root)
    {
        Text = "Idleon Card Profiles"; ClientSize = new Size(540, 226); StartPosition = FormStartPosition.CenterScreen;
        Font = SystemFonts.MessageBoxFont; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Label title = new Label { Text = "Ready to play", Location = new Point(22, 22), AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 15, FontStyle.Bold) };
        Label body = new Label { Text = "Open Idleon in Steam and click Play.\nThe desktop shortcut also opens it through Steam.\n\nIn the game, open Codex > Cards to name your presets.", Location = new Point(22, 63), Size = new Size(496, 76) };
        Button play = new Button { Text = "Play", Location = new Point(319, 176), Size = new Size(112, 30) };
        Button later = new Button { Text = "Later", DialogResult = DialogResult.Cancel, Location = new Point(440, 176), Size = new Size(78, 30) };
        play.Click += delegate {
            play.Enabled = false;
            try {
                Launcher.OpenSteamGame(root);
                Close();
            }
            catch (Exception error) { MessageBox.Show(this, error.Message, "Could not start Card Profiles", MessageBoxButtons.OK, MessageBoxIcon.Warning); play.Enabled = true; }
        };
        Controls.AddRange(new Control[] { title, body, play, later }); AcceptButton = play; CancelButton = later;
    }
}

internal sealed class UninstallForm : Form
{
    public UninstallForm()
    {
        Text = "Uninstall Card Profiles"; ClientSize = new Size(540, 244); StartPosition = FormStartPosition.CenterScreen;
        Font = SystemFonts.MessageBoxFont; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Label instructions = new Label { Text = "Exit Idleon and Steam first", Location = new Point(22, 22), AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 13, FontStyle.Bold) };
        Label body = new Label { Text = "Uninstall restores your previous Steam launch settings.\nTo fully exit Steam, choose Steam > Exit.\n\nYour saved profiles will stay in:\n" + Setup.DataRoot + "\n\nThe installed files will be kept in a recovery folder.", Location = new Point(22, 61), Size = new Size(496, 126) };
        Button uninstall = new Button { Text = "Uninstall", Location = new Point(335, 201), Size = new Size(90, 28) };
        Button cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Location = new Point(435, 201), Size = new Size(83, 28) };
        uninstall.Click += delegate {
            try { string retained = Setup.Uninstall(); MessageBox.Show("Card Profiles was uninstalled. Your profiles are unchanged.\n\nRecovery copy:\n" + retained + "\n\nRun setup to reinstall.", "Card Profiles", MessageBoxButtons.OK, MessageBoxIcon.Information); Close(); }
            catch (Exception error) { MessageBox.Show(error.Message, "Uninstall could not finish", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        };
        Controls.AddRange(new Control[] { instructions, body, uninstall, cancel }); AcceptButton = uninstall; CancelButton = cancel;
    }
}
