using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class PackagingTests
{
    private static int checks;
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    private static void Throws(Action action, string message) { bool rejected = false; try { action(); } catch (Exception) { rejected = true; } Assert(rejected, message); }
    private static byte[] Zip(string fileName, bool corrupt, bool extra, bool duplicate, bool symlink)
    {
        byte[] bytes = Encoding.UTF8.GetBytes("workspace fixture"); string hash;
        using (SHA256 sha = SHA256.Create()) { hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        PayloadManifest manifest = new PayloadManifest { product = Setup.Product, version = "0.1.0", files = new List<PayloadFile> { new PayloadFile { path = fileName, size = bytes.Length, sha256 = corrupt ? new String('0', 64) : hash } } };
        using (MemoryStream memory = new MemoryStream())
        {
            using (ZipArchive zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            {
                using (StreamWriter writer = new StreamWriter(zip.CreateEntry("manifest.json").Open())) { writer.Write(new JavaScriptSerializer().Serialize(manifest)); }
                ZipArchiveEntry file = zip.CreateEntry(fileName);
                if (symlink) file.ExternalAttributes = unchecked((int)0xA1FF0000);
                using (Stream writer = file.Open()) { writer.Write(bytes, 0, bytes.Length); }
                if (extra) zip.CreateEntry("extra.txt");
                if (duplicate) zip.CreateEntry(fileName.ToUpperInvariant());
            }
            return memory.ToArray();
        }
    }
    private static void RejectZip(string root, string label, byte[] bytes)
    {
        string dest = Path.Combine(root, label);
        Throws(delegate { using (MemoryStream input = new MemoryStream(bytes)) { Setup.Extract(input, dest); } }, "Rejected " + label);
        Assert(!Directory.Exists(dest), "No files written before " + label + " rejection");
    }
    private static void Render(Form form, string output)
    {
        using (form) using (Bitmap bitmap = new Bitmap(form.ClientSize.Width, form.ClientSize.Height))
        {
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(form.BackColor);
                foreach (Control control in form.Controls)
                {
                    using (Bitmap piece = new Bitmap(control.Width, control.Height))
                    {
                        control.CreateControl(); control.DrawToBitmap(piece, new Rectangle(0, 0, piece.Width, piece.Height));
                        graphics.DrawImageUnscaled(piece, control.Left, control.Top);
                    }
                }
            }
            bitmap.Save(output);
        }
    }
    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) throw new ArgumentException("Test root and extracted bundled node path are required.");
            string root = Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
            string[] baseArgs = Launcher.BuildArguments(root, new string[0]);
            Assert(baseArgs.Length == 3 && baseArgs[1] == "launch" && baseArgs[2] == "--live", "Default launch contract");
            string[] gameArgs = new string[] { "--steam", @"C:\Steam Library\steamapps\common\Legends of Idleon\LegendsOfIdleon.exe", "", "two words", "quote\"inside", "trail\\", "double\\\\\"quote", "& | < > ^ % ! $()", "Unicode é雪", "line\nbreak" };
            string[] forwarded = Launcher.BuildArguments(root, gameArgs);
            Assert(forwarded[1] == "steam" && forwarded[2] == "--" && forwarded.Length == gameArgs.Length + 2, "Steam command contract");
            Throws(delegate { Launcher.BuildArguments(root, new string[] { "--steam", "C:LegendsOfIdleon.exe" }); }, "Reject drive-relative executable");
            Throws(delegate { Launcher.BuildArguments(root, new string[] { "--steam", @"\LegendsOfIdleon.exe" }); }, "Reject root-relative executable");
            Throws(delegate { Launcher.BuildArguments(root, new string[] { "--steam", @"C:\other.exe" }); }, "Reject unrelated executable");
            List<string> nodeArgs = new List<string>(new string[] { "--eval", "console.log(JSON.stringify(process.argv.slice(1)))", "--" }); nodeArgs.AddRange(forwarded);
            ProcessStartInfo start = new ProcessStartInfo(args[1], Launcher.JoinArguments(nodeArgs.ToArray())) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = root };
            using (Process node = Process.Start(start))
            {
                string text = node.StandardOutput.ReadToEnd(); string error = node.StandardError.ReadToEnd(); node.WaitForExit(); Assert(node.ExitCode == 0, "Node argv fixture exited cleanly: " + error);
                string[] received = new JavaScriptSerializer().Deserialize<string[]>(text);
                Assert(received.Length == forwarded.Length, "Preserve argument count");
                for (int i = 0; i < received.Length; i++) Assert(received[i] == forwarded[i], "Preserve Windows argument " + i);
            }
            string valid = Path.Combine(root, "valid");
            using (MemoryStream input = new MemoryStream(Zip("src/test.txt", false, false, false, false))) { Setup.Extract(input, valid); }
            Assert(File.ReadAllText(Path.Combine(valid, "src", "test.txt")) == "workspace fixture", "Valid payload extracted");
            Throws(delegate { using (MemoryStream input = new MemoryStream(Zip("src/test.txt", false, false, false, false))) { Setup.Extract(input, valid); } }, "Refuse nonempty destination");
            RejectZip(root, "traversal", Zip("../escape.txt", false, false, false, false));
            RejectZip(root, "absolute", Zip("C:/escape.txt", false, false, false, false));
            RejectZip(root, "backslash", Zip("src\\escape.txt", false, false, false, false));
            RejectZip(root, "device", Zip("src/CON.txt", false, false, false, false));
            RejectZip(root, "trailing-dot", Zip("src/test.", false, false, false, false));
            RejectZip(root, "checksum", Zip("src/test.txt", true, false, false, false));
            RejectZip(root, "unlisted", Zip("src/test.txt", false, true, false, false));
            RejectZip(root, "duplicate", Zip("src/test.txt", false, false, true, false));
            RejectZip(root, "symlink", Zip("src/test.txt", false, false, false, true));
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Render(new InstallForm(), Path.Combine(root, "installer.png"));
            Render(new InstalledForm(root), Path.Combine(root, "installed.png"));
            Render(new SteamSetup(@"C:\Users\Example\AppData\Local\Programs\IdleonCardProfiles"), Path.Combine(root, "steam-setup.png"));
            Render(new UninstallForm(), Path.Combine(root, "uninstall.png"));
            Console.WriteLine("PASS: " + checks + " packaging checks. Forms rendered offscreen. No install, shortcuts, game, or Steam actions performed."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
