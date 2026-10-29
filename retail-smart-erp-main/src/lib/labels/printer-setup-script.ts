/**
 * Copy-and-paste printer setup for a sticker roll (Zebra / ZPL printers), generated from the setup so
 * every roll size gets its own command:
 *  - Windows: a PowerShell block that adds the paper size, saves the media settings in the printer
 *    (sent raw to the queue, bypassing the driver), calibrates and prints a numbered test.
 *  - Mac / Linux: the same through CUPS (lp -o raw, lpoptions PageSize).
 *
 * Two modes:
 *  - 'gap': the printer's sensor finds the gap before every row (re-aligns itself, no drift). The paper
 *    is one label high. Use it whenever the test comes out inside the stickers.
 *  - 'continuous': for rolls where the sensor cannot see the gaps (e.g. it sits between two columns).
 *    The paper is label + gap high and the printer never moves the paper on power-up or lid close.
 *
 * Pure module (web + tests).
 */
import { stickerRollWidthMm, type StickerSetup } from './sticker-stock'

export type MediaMode = 'gap' | 'continuous'

type Geometry = Pick<StickerSetup, 'labelWidthMm' | 'labelHeightMm' | 'columns' | 'columnGapMm' | 'rowGapMm' | 'marginLeftMm' | 'offsetXMm' | 'offsetYMm' | 'dpi'>

const round1 = (n: number) => Math.round(n * 10) / 10
const fmt = (n: number) => String(round1(n))

/** Paper (= one row) size the driver / Chrome must use in this mode. */
export function setupPaperMm(s: Geometry, mode: MediaMode): { widthMm: number; heightMm: number; name: string } {
  const widthMm = round1(stickerRollWidthMm(s))
  const heightMm = round1(mode === 'gap' ? s.labelHeightMm : s.labelHeightMm + s.rowGapMm)
  return { widthMm, heightMm, name: `Label ${fmt(widthMm)}x${fmt(heightMm)}mm` }
}

const dots = (mm: number, dpi: number) => Math.max(0, Math.round((mm * dpi) / 25.4))

/** ZPL saved in the printer (^JUS): media tracking, width, length, power-up / lid-close action. */
export function zebraConfigZpl(s: Geometry, mode: MediaMode): string {
  const p = setupPaperMm(s, mode)
  const action = mode === 'gap' ? '^MFF,F' : '^MFN,N'
  return `^XA^MN${mode === 'gap' ? 'Y' : 'N'}^PW${dots(p.widthMm, s.dpi)}^LL${dots(p.heightMm, s.dpi)}${action}^LH0,0^JUS^XZ`
}

/** Two rows of numbered boxes, 0.5 mm inside each sticker, at the setup's column positions and offsets. */
export function zebraTestZpl(s: Geometry, mode: MediaMode): string {
  const p = setupPaperMm(s, mode)
  const d = (mm: number) => dots(mm, s.dpi)
  const boxW = d(s.labelWidthMm - 1)
  const boxH = d(s.labelHeightMm - 1)
  const font = Math.max(20, Math.min(120, Math.round(boxH * 0.45)))
  const y = d(Math.max(0, s.offsetYMm + 0.5))
  const rows: string[] = []
  let n = 1
  for (let row = 0; row < 2; row++) {
    let f = `^XA^MN${mode === 'gap' ? 'Y' : 'N'}^PW${d(p.widthMm)}^LL${d(p.heightMm)}^LH0,0`
    for (let k = 0; k < s.columns; k++) {
      const x = d(Math.max(0, s.marginLeftMm + s.offsetXMm + k * (s.labelWidthMm + s.columnGapMm) + 0.5))
      f += `^FO${x},${y}^GB${boxW},${boxH},3^FS^FO${x},${y + Math.round((boxH - font) / 2)}^A0N,${font},${font}^FB${boxW},1,0,C^FD${n++}^FS`
    }
    rows.push(`${f}^PQ1^XZ`)
  }
  return rows.join('')
}

/** PowerShell block for Windows (no Administrator needed; one optional step uses it when available). */
export function windowsSetupScript(s: Geometry & Pick<StickerSetup, 'name'>, mode: MediaMode): string {
  const p = setupPaperMm(s, mode)
  const micron = (mm: number) => Math.round(mm * 1000)
  const safeName = s.name.replace(/[^\w .x×()-]/g, '').slice(0, 60)
  return `# skyERPOS label printer setup: ${safeName} - ${mode === 'gap' ? 'gap sensing' : 'continuous'} - paper ${p.name}
$printer = (Get-Printer | Where-Object { $_.Name -match 'ZDesigner|Zebra|ZD[0-9]|ZPL' -and "$($_.PrinterStatus)" -ne 'PendingDeletion' } | Sort-Object { $_.Name -match 'Copy' }, Name | Select-Object -First 1).Name
if (-not $printer) { throw 'No Zebra printer found. Install the ZDesigner driver and connect the printer first.' }
Write-Host "Printer: $printer"
if (-not ('SkyLabelSetup1' -as [type])) {
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SkyLabelSetup1 {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct FORM_INFO_1 { public uint Flags; public string pName; public int cx; public int cy; public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct PRINTER_DEFAULTS { public IntPtr pDatatype; public IntPtr pDevMode; public uint DesiredAccess; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenServer(string n, out IntPtr h, ref PRINTER_DEFAULTS d);
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", EntryPoint="AddFormW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool AddForm(IntPtr h, uint l, ref FORM_INFO_1 f);
  [DllImport("winspool.drv", EntryPoint="DeleteFormW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DeleteForm(IntPtr h, string n);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr h, int l, [In] DOCINFO di);
  [DllImport("winspool.drv")] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  [DllImport("winspool.drv")] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
  public static string AddPaper(string name, int w, int h) {
    var d = new PRINTER_DEFAULTS(); d.DesiredAccess = 1; IntPtr s;
    if (!OpenServer(null, out s, ref d)) return "could not open the print server (error " + Marshal.GetLastWin32Error() + ")";
    DeleteForm(s, name);
    var f = new FORM_INFO_1(); f.pName = name; f.cx = w; f.cy = h; f.right = w; f.bottom = h;
    bool ok = AddForm(s, 1, ref f); int err = Marshal.GetLastWin32Error(); ClosePrinter(s);
    return ok ? "OK" : "error " + err;
  }
  public static string Send(string printer, string data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "could not open the printer (error " + Marshal.GetLastWin32Error() + ")";
    var di = new DOCINFO(); di.pDocName = "skyERPOS label setup"; di.pDataType = "RAW";
    if (StartDocPrinter(h, 1, di) == 0) { int e = Marshal.GetLastWin32Error(); ClosePrinter(h); return "could not start the job (error " + e + ")"; }
    StartPagePrinter(h); var b = System.Text.Encoding.ASCII.GetBytes(data); int n; WritePrinter(h, b, b.Length, out n);
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h); return "OK";
  }
}
'@
}
Write-Host ("Paper size '${p.name}': " + [SkyLabelSetup1]::AddPaper('${p.name}', ${micron(p.widthMm)}, ${micron(p.heightMm)}))
Get-PrintJob -PrinterName $printer -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
Write-Host ("Printer settings saved: " + [SkyLabelSetup1]::Send($printer, '${zebraConfigZpl(s, mode)}'))
${mode === 'gap'
    ? `Start-Sleep 2
Write-Host 'Calibrating (the printer feeds a few stickers)...'
[SkyLabelSetup1]::Send($printer, '~JC') | Out-Null
Start-Sleep 8`
    : 'Start-Sleep 2'}
Write-Host ("Test print (2 rows, numbered boxes): " + [SkyLabelSetup1]::Send($printer, '${zebraTestZpl(s, mode)}'))
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
if ($admin) { rundll32 printui.dll,PrintUIEntry /Xs /n "$printer" attributes +queued; Write-Host 'Windows sends each print job whole (start after last page is spooled).' }
else { Write-Host 'Optional: run this once in an Administrator PowerShell to also make Windows send each job whole.' }
Write-Host ''
Write-Host 'NEXT: Zebra Printing preferences > Page Setup > Stocks > New: ${fmt(p.widthMm)} x ${fmt(p.heightMm)} mm, type ${mode === 'gap' ? 'Labels with gaps (Non-continuous, web sensing)' : 'Continuous'}.'
Write-Host 'In Chrome print preview: Paper size ${p.name} (or that stock), Margins None, Scale Default.'
`
}

/** Shell block for Mac / Linux (CUPS). */
export function cupsSetupScript(s: Geometry & Pick<StickerSetup, 'name'>, mode: MediaMode): string {
  const p = setupPaperMm(s, mode)
  return `# skyERPOS label printer setup (Mac / Linux): ${mode === 'gap' ? 'gap sensing' : 'continuous'} - paper ${fmt(p.widthMm)} x ${fmt(p.heightMm)} mm
Q=$(lpstat -d 2>/dev/null | sed -n 's/^.*: //p'); echo "$Q" | grep -qiE 'zd|zebra|zpl' || Q=$(lpstat -e | grep -iE 'zd|zebra|zpl' | head -1); echo "Printer: $Q"
cancel -a "$Q" 2>/dev/null
printf '%s' '${zebraConfigZpl(s, mode)}' | lp -d "$Q" -o raw
${mode === 'gap' ? `sleep 2; printf '%s' '~JC' | lp -d "$Q" -o raw; sleep 8\n` : 'sleep 2\n'}printf '%s' '${zebraTestZpl(s, mode)}' | lp -d "$Q" -o raw
lpoptions -p "$Q" -o PageSize=Custom.${fmt(p.widthMm)}x${fmt(p.heightMm)}mm
echo "Done. In Chrome print preview choose paper ${fmt(p.widthMm)} x ${fmt(p.heightMm)} mm, Margins None."
`
}
