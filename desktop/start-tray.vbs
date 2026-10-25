' Starts the Tracker tray with no console window. Pass /open to also open the tracker window.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "tray.ps1")
args = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/open" Then args = " -Open"
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """" & args, 0, False
