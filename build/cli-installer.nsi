Unicode true
!include "MUI2.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "1.0.0"
!endif

Name "Agent_Team CLI ${APP_VERSION}"
OutFile "..\release\Agent_Team-CLI-Setup-v${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Agent_Team_CLI"
InstallDirRegKey HKCU "Software\Agent_Team_CLI" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 Agent_Team CLI v${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "本安装程序将安装纯粹命令行版 Agent_Team CLI (agent-team.exe)，并自动将安装目录写入当前用户的 PATH 环境变量，方便您在任意终端或 AI Agent 会话中直接调用 `agent-team`。"
!define MUI_FINISHPAGE_TITLE "Agent_Team CLI 安装完成"
!define MUI_FINISHPAGE_TEXT "已安装 agent-team.exe 并自动写入用户 PATH。$\r$\n$\r$\n请重新打开终端或 Agent 会话，运行以下指令开始使用：$\r$\n  agent-team detect$\r$\n  agent-team --help"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Agent_Team CLI (Core)" SecMain
  SetOutPath "$INSTDIR"
  File "/oname=agent-team.exe" "..\release\agent-team-cli.exe"
  File "path-helper.ps1"

  DetailPrint "正在将 Agent_Team CLI 目录写入用户 PATH 环境变量..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\path-helper.ps1" -Action add -Dir "$INSTDIR"'

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Agent_Team_CLI" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "DisplayName" "Agent_Team CLI"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "Publisher" "Agent_Team"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI" "NoRepair" 1
SectionEnd

Section "Uninstall"
  DetailPrint "正在从用户 PATH 环境变量移除 Agent_Team CLI..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\path-helper.ps1" -Action remove -Dir "$INSTDIR"'

  Delete "$INSTDIR\agent-team.exe"
  Delete "$INSTDIR\path-helper.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Agent_Team_CLI"
  DeleteRegKey HKCU "Software\Agent_Team_CLI"
SectionEnd
