!macro customInstall
  DetailPrint "Registering Agent_Team CLI (agent-team) in User PATH..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\path-helper.ps1" -Action add -Dir "$INSTDIR\resources\bin"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Agent_Team CLI from User PATH..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\path-helper.ps1" -Action remove -Dir "$INSTDIR\resources\bin"'
!macroend
