import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const executable = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
)
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$modules = $env:PSModulePath
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ReplicaCommandJob {
  [StructLayout(LayoutKind.Sequential)]
  struct Limits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public Limits Basic;
    public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Startup {
    public uint Size;
    public IntPtr Reserved, Desktop, Title;
    public uint X, Y, Width, Height, CharactersX, CharactersY, FillAttribute, Flags;
    public ushort ShowWindow, ReservedSize;
    public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity,
    IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory,
    ref Startup startup, out ProcessInformation process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateEvent(IntPtr security, bool manualReset, bool initial, string name);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr OpenEvent(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetEvent(IntPtr handle);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  static void Check(bool success) {
    if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  static string Quote(string value) {
    var result = new StringBuilder("\\\"");
    int slashes = 0;
    foreach (char character in value) {
      if (character == '\\\\') { slashes++; continue; }
      result.Append('\\\\', character == '"' ? slashes * 2 + 1 : slashes);
      result.Append(character);
      slashes = 0;
    }
    result.Append('\\\\', slashes * 2);
    return result.Append('"').ToString();
  }
  static uint Active(IntPtr job) {
    Accounting accounting;
    Check(QueryInformationJobObject(job, 1, out accounting,
      (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
    return accounting.ActiveProcesses;
  }
  static void WaitEmpty(IntPtr job, bool bounded) {
    var elapsed = Stopwatch.StartNew();
    while (Active(job) != 0) {
      if (bounded && elapsed.ElapsedMilliseconds >= 6000)
        throw new InvalidOperationException("Owned command processes did not stop.");
      Thread.Sleep(25);
    }
  }
  public static int Run(string name, string executable, string[] arguments) {
    IntPtr job = IntPtr.Zero, ready = IntPtr.Zero;
    ProcessInformation process = new ProcessInformation();
    try {
      job = CreateJobObject(IntPtr.Zero, name);
      Check(job != IntPtr.Zero);
      var limits = new ExtendedLimits();
      limits.Basic.Flags = 0x2000;
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      var startup = new Startup();
      startup.Size = (uint)Marshal.SizeOf(typeof(Startup));
      startup.Flags = 0x100;
      startup.Input = GetStdHandle(-10);
      startup.Output = GetStdHandle(-11);
      startup.Error = GetStdHandle(-12);
      var command = new StringBuilder(Quote(executable));
      foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
      // Assign the suspended process before any descendant can start outside the job.
      Check(CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, true, 4,
        IntPtr.Zero, null, ref startup, out process));
      Check(AssignProcessToJobObject(job, process.Process));
      ready = CreateEvent(IntPtr.Zero, true, false, name + "-ready");
      Check(ready != IntPtr.Zero);
      Check(SetEvent(ready));
      Check(ResumeThread(process.Thread) != UInt32.MaxValue);
      Check(WaitForSingleObject(process.Process, UInt32.MaxValue) == 0);
      uint code;
      Check(GetExitCodeProcess(process.Process, out code));
      WaitEmpty(job, false);
      return unchecked((int)code);
    } finally {
      if (process.Process != IntPtr.Zero) {
        TerminateProcess(process.Process, 1);
        CloseHandle(process.Process);
      }
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (ready != IntPtr.Zero) CloseHandle(ready);
      if (job != IntPtr.Zero) CloseHandle(job);
    }
  }
  public static void Stop(string name, int launcher) {
    IntPtr ready = IntPtr.Zero, job = IntPtr.Zero;
    var elapsed = Stopwatch.StartNew();
    try {
      while (ready == IntPtr.Zero) {
        ready = OpenEvent(0x100000, false, name + "-ready");
        if (ready != IntPtr.Zero) break;
        if (Marshal.GetLastWin32Error() != 2) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
          using (var process = Process.GetProcessById(launcher)) {
            if (process.HasExited) return;
          }
        } catch (ArgumentException) { return; }
        if (elapsed.ElapsedMilliseconds >= 10000)
          throw new InvalidOperationException("Owned command did not become ready for cleanup.");
        Thread.Sleep(25);
      }
      Check(WaitForSingleObject(ready, 10000) == 0);
      job = OpenJobObject(12, false, name);
      if (job == IntPtr.Zero && Marshal.GetLastWin32Error() == 2) return;
      Check(job != IntPtr.Zero);
      Check(TerminateJobObject(job, 1));
      WaitEmpty(job, true);
    } finally {
      if (job != IntPtr.Zero) CloseHandle(job);
      if (ready != IntPtr.Zero) CloseHandle(ready);
    }
  }
}
'@
  $env:PSModulePath = $modules
  $name = $env:REPLICA_COMMAND_JOB
  $mode = $env:REPLICA_COMMAND_MODE
  $env:REPLICA_COMMAND_JOB = $null
  $env:REPLICA_COMMAND_MODE = $null
  if ($mode -eq 'stop') {
    [ReplicaCommandJob]::Stop($name, [int]$env:REPLICA_COMMAND_LAUNCHER)
  } else {
    [void][Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
    $payload = [Web.Script.Serialization.JavaScriptSerializer]::new().DeserializeObject($env:REPLICA_COMMAND_PAYLOAD)
    $env:REPLICA_COMMAND_PAYLOAD = $null
    [Environment]::Exit([ReplicaCommandJob]::Run($name, $payload['executable'], [string[]]$payload['args']))
  }
} catch {
  [Console]::Error.WriteLine('The owned Windows command could not start or finish safely.')
  exit 1
}
`
const args = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-OutputFormat",
  "Text",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
]

export function windowsJobCommand(command: {
  executable: string
  args: string[]
  env: NodeJS.ProcessEnv
}): { name: string; executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  const name = `Local\\ReplicaCommand-${randomUUID()}`
  return {
    name,
    executable,
    args,
    env: {
      ...command.env,
      REPLICA_COMMAND_JOB: name,
      REPLICA_COMMAND_MODE: "run",
      REPLICA_COMMAND_PAYLOAD: JSON.stringify({
        executable: command.executable,
        args: command.args,
      }),
    },
  }
}

export async function stopWindowsJob(name: string, launcher: number): Promise<void> {
  await execute(executable, args, {
    env: {
      ...process.env,
      REPLICA_COMMAND_JOB: name,
      REPLICA_COMMAND_MODE: "stop",
      REPLICA_COMMAND_LAUNCHER: String(launcher),
    },
    windowsHide: true,
    timeout: 25_000,
  })
}
