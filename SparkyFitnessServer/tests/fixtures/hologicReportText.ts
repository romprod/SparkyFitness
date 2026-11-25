/**
 * SYNTHETIC Hologic APEX report text (rows laid out one to a line), ported from Pitstop's report
 * fixture: an invented subject, 178 cm, 82.0 kg, fat 16 400 g, lean 61 800 g, bone mineral
 * 2 800 g. Serial TEST1, facility "Example Clinic", reference "NHANES-Example". The regions add
 * up exactly to the subtotal plus the head, which is the total; the indices agree with the
 * printed ones.
 */
export const HOLOGIC_TEMPLATE = `Example Clinic
Patient: SYNTHETIC SUBJECT
Sex: Male   Height: 178.0 cm   Weight: 82.0 kg   Age: 40
Scan Date: 10 January 2026
Scan Type: a Whole Body
Model: Horizon A (S/N TEST1)
Analysis: APEX Version 13.6
Age-matched Z-score. T-score vs. Example Male. Source: NHANES-Example
DXA Results Summary
Region BMC (g) Fat Mass (g) Lean Mass (g) Lean + BMC (g) Total Mass (g) % Fat
L Arm 200.00 1000.0 3500.0 3700.0 4700.0 21.3
R Arm 210.00 1050.0 3700.0 3910.0 4960.0 21.2
Trunk 800.00 7300.0 30000.0 30800.0 38100.0 19.2
L Leg 500.00 2900.0 10600.0 11100.0 14000.0 20.7
R Leg 510.00 2950.0 10700.0 11210.0 14160.0 20.8
Subtotal 2220.00 15200.0 58500.0 60720.0 75920.0 20.0
Head 580.00 1200.0 3300.0 3880.0 5080.0 23.6
Total 2800.00 16400.0 61800.0 64600.0 81000.0 20.2
Body Composition Results
Region Fat Mass (g) Lean + BMC (g) Total Mass (g) % Fat %Fat Percentile YN %Fat Percentile AM
L Arm 1000 3700 4700 21.3 55 45
R Arm 1050 3910 4960 21.2 54 44
Trunk 7300 30800 38100 19.2 48 40
L Leg 2900 11100 14000 20.7 52 42
R Leg 2950 11210 14160 20.8 53 43
Subtotal 15200 60720 75920 20.0 50 40
Total 16400 64600 81000 20.2 50 40
Android (A) 1200 4800 6000 20.0
Gynoid (G) 2700 10300 13000 20.8
Adipose Indices Measure Result Percentile YN Percentile AM
Total Body % Fat 20.2 50 40
Fat Mass/Height² (kg/m²) 5.18 45 38
Android/Gynoid Ratio 0.96
Est. VAT Mass (g) 500
Est. VAT Volume (cm³) 540
Est. VAT Area (cm²) 104.0
Lean Indices
Lean/Height² (kg/m²) 19.5 60 55
Appen. Lean/Height² (kg/m²) 8.99 62 58
BMD Results
Region Area (cm²) BMC (g) BMD (g/cm²) T-score Z-score
Head 290.00 580.00 2.000
L Arm 250.00 200.00 0.800
R Arm 262.50 210.00 0.800
L Ribs 100.00 80.00 0.800
R Ribs 100.00 80.00 0.800
T Spine 120.00 120.00 1.000
L Spine 60.00 60.00 1.000
Pelvis 250.00 300.00 1.200
L Leg 500.00 500.00 1.000
R Leg 510.00 510.00 1.000
Subtotal 2043.33 2220.00 1.087
Total 2333.33 2800.00 1.200 0.1 0.1
Total BMD CV 1.0%
`;
