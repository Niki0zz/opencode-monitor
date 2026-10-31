Option Explicit

Dim fso, shell, dir, electron
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
  MsgBox "Dependencies are missing. Run 'npm install' in this folder first.", 48, "OpenCode Monitor"
  WScript.Quit 1
End If

shell.CurrentDirectory = dir
shell.Run """" & electron & """ """ & dir & """", 0, False
