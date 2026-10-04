using System;
using System.Diagnostics;
using System.Windows.Forms;

internal static class LauncherLifecycleTests
{
    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            for (int i = 0; i < 3; i++)
            {
                ProcessStartInfo start = new ProcessStartInfo(args[0], "--eval \"setTimeout(() => process.exit(0), 20)\"");
                start.UseShellExecute = false; start.CreateNoWindow = true;
                using (Process child = Process.Start(start))
                {
                    using (HelperTray tray = new HelperTray(AppDomain.CurrentDomain.BaseDirectory, child, false))
                    {
                        Application.Run(tray);
                        // Application.Run already disposes this ApplicationContext.
                        // Both explicit disposal and the enclosing using must be safe.
                        tray.Dispose(); tray.Dispose();
                    }
                    if (child.ExitCode != 0) throw new Exception("Fixture helper failed.");
                }
            }
            Console.WriteLine("PASS: 3 helper exits and repeated ApplicationContext disposal. No visible tray, forms, or game.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
