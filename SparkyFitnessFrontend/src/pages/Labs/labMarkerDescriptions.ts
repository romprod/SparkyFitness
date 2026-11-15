/** Measure-only explanations verified against the primary sources alongside each entry.
 * Catalogue identity is explicit: never infer a custom marker's meaning from its name.
 * Source review: 2026-11-15. No diagnoses, thresholds or treatment advice.
 */
export const LAB_MARKER_DESCRIPTIONS: Readonly<
  Record<string, { description: string; sources: readonly string[] }>
> = {
  hba1c: {
    description:
      'Measures the proportion of haemoglobin with glucose attached, reflecting average blood glucose over roughly the previous two to three months.',
    sources: ['https://medlineplus.gov/lab-tests/hemoglobin-a1c-hba1c-test/'],
  },
  fasting_glucose: {
    description:
      'Measures the concentration of glucose in blood after fasting.',
    sources: ['https://medlineplus.gov/lab-tests/blood-glucose-test/'],
  },
  total_cholesterol: {
    description:
      'Measures the total cholesterol carried in the different lipoproteins in blood.',
    sources: [
      'https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html',
    ],
  },
  hdl: {
    description:
      'Reports the amount of cholesterol carried by high-density lipoproteins (HDL) in blood.',
    sources: ['https://medlineplus.gov/lab-tests/cholesterol-levels/'],
  },
  ldl: {
    description:
      'Reports the amount of cholesterol carried by low-density lipoproteins (LDL) in blood.',
    sources: ['https://medlineplus.gov/lab-tests/cholesterol-levels/'],
  },
  triglycerides: {
    description: 'Measures triglycerides, a type of fat circulating in blood.',
    sources: ['https://medlineplus.gov/lab-tests/cholesterol-levels/'],
  },
  vitamin_d: {
    description:
      'Measures blood 25-hydroxyvitamin D, the main form used to assess vitamin D levels.',
    sources: ['https://medlineplus.gov/lab-tests/vitamin-d-test/'],
  },
  tsh: {
    description:
      'Measures thyroid-stimulating hormone, a pituitary hormone that signals the thyroid to make thyroid hormones.',
    sources: [
      'https://medlineplus.gov/ency/article/003684.htm',
      'https://medlineplus.gov/lab-tests/thyroxine-t4-test/',
    ],
  },
  ferritin: {
    description:
      'Measures blood ferritin, a protein that binds and stores iron.',
    sources: ['https://medlineplus.gov/lab-tests/ferritin-blood-test/'],
  },
  vitamin_b12: {
    description:
      'Measures the amount of vitamin B12, also called cobalamin, in blood.',
    sources: ['https://medlineplus.gov/lab-tests/vitamin-b-test/'],
  },
  creatinine: {
    description:
      'Measures blood creatinine, a waste product produced by muscles and filtered by the kidneys.',
    sources: ['https://medlineplus.gov/lab-tests/creatinine-test/'],
  },
  egfr: {
    description:
      'Estimates how quickly the kidneys filter blood using blood markers such as creatinine or cystatin C and an estimating equation.',
    sources: [
      'https://medlineplus.gov/lab-tests/estimated-glomerular-filtration-rate-egfr-and-gfr-tests/',
    ],
  },
  alt: {
    description:
      'Measures the activity of alanine transaminase (ALT), an enzyme, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  ast: {
    description:
      'Measures the activity of aspartate aminotransferase (AST), an enzyme, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  non_hdl: {
    description:
      'Calculates cholesterol outside HDL by subtracting HDL cholesterol from total cholesterol.',
    sources: [
      'https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html',
    ],
  },
  apob: {
    description:
      'Measures the blood concentration of apolipoprotein B, a protein carried on lipoprotein particles.',
    sources: ['https://www.nwlpathology.nhs.uk/test/apolipoprotein-b-apo-b/'],
  },
  vldl: {
    description:
      'Reports cholesterol carried by very-low-density lipoproteins (VLDL), often estimated from the blood triglyceride level.',
    sources: ['https://medlineplus.gov/lab-tests/cholesterol-levels/'],
  },
  fasting_insulin: {
    description:
      'Measures the concentration of insulin in blood after fasting.',
    sources: ['https://medlineplus.gov/lab-tests/insulin-in-blood-test/'],
  },
  wbc: {
    description: 'Counts white blood cells in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  rbc: {
    description: 'Counts red blood cells in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  hemoglobin: {
    description:
      'Measures the concentration of haemoglobin, the oxygen-carrying protein in red blood cells.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  hematocrit: {
    description:
      'Measures the proportion of blood volume occupied by red blood cells.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  mcv: {
    description: 'Reports the average volume of red blood cells.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  platelets: {
    description:
      'Counts platelets, the blood cell fragments involved in clotting, in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/complete-blood-count-cbc/'],
  },
  sodium: {
    description:
      'Measures the concentration of sodium, an electrolyte, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  potassium: {
    description:
      'Measures the concentration of potassium, an electrolyte, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  chloride: {
    description:
      'Measures the concentration of chloride, an electrolyte, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  bicarbonate: {
    description:
      'Measures total carbon dioxide in blood, most of which is present as bicarbonate.',
    sources: ['https://medlineplus.gov/lab-tests/carbon-dioxide-co2-in-blood/'],
  },
  calcium: {
    description: 'Measures the concentration of calcium in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  magnesium: {
    description: 'Measures the concentration of magnesium in blood.',
    sources: ['https://medlineplus.gov/lab-tests/magnesium-blood-test/'],
  },
  phosphorus: {
    description:
      'Measures phosphate in blood, the form in which phosphorus circulates.',
    sources: ['https://medlineplus.gov/lab-tests/phosphate-in-blood/'],
  },
  bun: {
    description:
      'Measures the nitrogen in blood urea, a waste product formed when the body breaks down proteins.',
    sources: ['https://medlineplus.gov/lab-tests/bun-blood-urea-nitrogen/'],
  },
  uric_acid: {
    description:
      'Measures blood uric acid, a waste product formed when the body breaks down purines.',
    sources: ['https://medlineplus.gov/lab-tests/uric-acid-test/'],
  },
  albumin: {
    description: 'Measures blood albumin, a protein made by the liver.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  total_protein: {
    description:
      'Measures the combined concentration of blood proteins, including albumin and globulins.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  alp: {
    description:
      'Measures the activity of alkaline phosphatase (ALP), an enzyme, in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  total_bilirubin: {
    description:
      'Measures total blood bilirubin, a pigment produced when red blood cells are broken down.',
    sources: [
      'https://medlineplus.gov/lab-tests/comprehensive-metabolic-panel-cmp/',
    ],
  },
  ggt: {
    description:
      'Measures the activity of gamma-glutamyl transferase (GGT), an enzyme, in blood.',
    sources: ['https://medlineplus.gov/lab-tests/liver-function-tests/'],
  },
  free_t4: {
    description:
      'Measures thyroxine (T4) in blood that is not bound to proteins.',
    sources: ['https://medlineplus.gov/lab-tests/thyroxine-t4-test/'],
  },
  free_t3: {
    description:
      'Measures triiodothyronine (T3) in blood that is not bound to proteins.',
    sources: ['https://medlineplus.gov/lab-tests/triiodothyronine-t3-tests/'],
  },
  iron: {
    description:
      'Measures iron circulating in the blood serum, rather than the iron stored in tissues.',
    sources: [
      'https://medlineplus.gov/ency/article/003488.htm',
      'https://medlineplus.gov/lab-tests/iron-tests/',
    ],
  },
  tibc: {
    description:
      'Measures the capacity of blood proteins, mainly transferrin, to bind iron.',
    sources: [
      'https://www.nhs.uk/tests-and-treatments/tibc-test/',
      'https://medlineplus.gov/lab-tests/iron-tests/',
    ],
  },
  transferrin_saturation: {
    description:
      'Reports the calculated percentage of transferrin iron-binding sites occupied by iron.',
    sources: [
      'https://www.nwlpathology.nhs.uk/test/transferrin-saturation/',
      'https://stacks.cdc.gov/view/cdc/5659/cdc_5659_DS1.pdf',
    ],
  },
  folate: {
    description:
      'Measures the amount of folate, also called vitamin B9, in blood.',
    sources: ['https://medlineplus.gov/lab-tests/vitamin-b-test/'],
  },
  crp: {
    description:
      'Measures C-reactive protein in blood; the high-sensitivity assay detects smaller amounts of the same protein.',
    sources: ['https://medlineplus.gov/lab-tests/c-reactive-protein-crp-test/'],
  },
  esr: {
    description:
      'Measures the speed at which red blood cells settle in a tube of blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/erythrocyte-sedimentation-rate-esr/',
    ],
  },
  homocysteine: {
    description: 'Measures homocysteine, an amino acid, in blood.',
    sources: ['https://medlineplus.gov/lab-tests/homocysteine-test/'],
  },
  cortisol: {
    description: 'Measures cortisol, a hormone made by the adrenal glands.',
    sources: ['https://medlineplus.gov/lab-tests/cortisol-test/'],
  },
  psa: {
    description:
      'Measures prostate-specific antigen (PSA), a protein produced by the prostate.',
    sources: [
      'https://medlineplus.gov/lab-tests/prostate-specific-antigen-psa-test/',
    ],
  },
  testosterone: {
    description:
      'Reports total testosterone in blood, including both protein-bound and unbound testosterone.',
    sources: ['https://medlineplus.gov/lab-tests/testosterone-levels-test/'],
  },
  estradiol: {
    description: 'Measures oestradiol (E2), one of the oestrogen hormones.',
    sources: ['https://medlineplus.gov/lab-tests/estrogen-levels-test/'],
  },
  lipoprotein_a: {
    description:
      'Measures lipoprotein(a), a particle that carries cholesterol in blood.',
    sources: ['https://medlineplus.gov/lab-tests/lipoprotein-a-blood-test/'],
  },
  ketones: {
    description:
      'Measures beta-hydroxybutyrate, a ketone produced when the body uses fat for energy.',
    sources: [
      'https://www.gloshospitals.nhs.uk/our-services/services-we-offer/pathology/tests-and-investigations/beta-hydroxybutyrate-bohb/',
      'https://medlineplus.gov/lab-tests/ketones-in-blood/',
    ],
  },
  c_peptide: {
    description:
      'Measures C-peptide, a substance released when the pancreas makes insulin.',
    sources: ['https://medlineplus.gov/lab-tests/c-peptide-test/'],
  },
  fructosamine: {
    description:
      'Measures blood proteins with glucose attached, mainly albumin.',
    sources: [
      'https://www.gloshospitals.nhs.uk/our-services/services-we-offer/pathology/tests-and-investigations/fructosamine/',
    ],
  },
  neutrophils: {
    description:
      'Counts neutrophils, a type of white blood cell, in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/blood-differential/'],
  },
  lymphocytes: {
    description:
      'Counts lymphocytes, a type of white blood cell, in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/blood-differential/'],
  },
  monocytes: {
    description:
      'Counts monocytes, a type of white blood cell, in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/blood-differential/'],
  },
  eosinophils: {
    description:
      'Counts eosinophils, a type of white blood cell, in a given volume of blood.',
    sources: ['https://medlineplus.gov/lab-tests/blood-differential/'],
  },
  mch: {
    description:
      'Reports the average amount of haemoglobin contained in each red blood cell.',
    sources: ['https://medlineplus.gov/lab-tests/red-blood-cell-rbc-indices/'],
  },
  mchc: {
    description:
      'Reports the average concentration of haemoglobin within red blood cells.',
    sources: ['https://medlineplus.gov/lab-tests/red-blood-cell-rbc-indices/'],
  },
  rdw: {
    description: 'Describes how much the sizes of red blood cells vary.',
    sources: [
      'https://medlineplus.gov/lab-tests/rdw-red-cell-distribution-width/',
    ],
  },
  mpv: {
    description:
      'Reports the average size of platelets, which help blood to clot.',
    sources: ['https://medlineplus.gov/lab-tests/mpv-blood-test/'],
  },
  globulin: {
    description:
      'Reports globulin protein concentration, usually calculated by subtracting albumin from total protein in blood.',
    sources: [
      'https://pathology.uhsussex.nhs.uk/pug/biochemistry-immunology/biochemistry-tests/358-globulin',
      'https://medlineplus.gov/lab-tests/globulin-test/',
    ],
  },
  direct_bilirubin: {
    description:
      'Reports conjugated (direct) bilirubin, the form processed by the liver for excretion in bile.',
    sources: ['https://www.nwlpathology.nhs.uk/test/bilirubin-conjugated/'],
  },
  anion_gap: {
    description:
      'Reports a calculated difference between selected positively and negatively charged electrolytes in blood.',
    sources: ['https://medlineplus.gov/lab-tests/anion-gap-blood-test/'],
  },
  bun_creatinine_ratio: {
    description:
      'Reports the ratio of blood urea nitrogen (BUN) to creatinine.',
    sources: [
      'https://www.beaumontlaboratory.com/lab-test-directory/detail?URL=bun-creatinine-ratio&itemID=1',
    ],
  },
  cystatin_c: {
    description:
      'Measures cystatin C, a small protein filtered from blood by the kidneys.',
    sources: [
      'https://www.ruh.nhs.uk/pathology/blood_test_info/tubelisting.asp?id=591&listing=c',
    ],
  },
  urine_albumin_creatinine: {
    description:
      'Reports the ratio of albumin to creatinine in a urine sample, allowing for how concentrated the urine is.',
    sources: [
      'https://www.niddk.nih.gov/health-information/professionals/advanced-search/quick-reference-uacr-gfr',
    ],
  },
  amylase: {
    description:
      'Measures amylase, a digestive enzyme made mainly by the pancreas and salivary glands.',
    sources: ['https://medlineplus.gov/lab-tests/amylase-test/'],
  },
  lipase: {
    description: 'Measures lipase, an enzyme that helps break down fats.',
    sources: ['https://medlineplus.gov/lab-tests/lipase-tests/'],
  },
  ldh: {
    description:
      'Measures lactate dehydrogenase (LDH), an enzyme involved in energy production in many body tissues.',
    sources: [
      'https://medlineplus.gov/lab-tests/lactate-dehydrogenase-ldh-test/',
    ],
  },
  ck: {
    description:
      'Measures creatine kinase (CK), an enzyme found mainly in skeletal muscle and also in the heart and brain.',
    sources: ['https://medlineplus.gov/lab-tests/creatine-kinase/'],
  },
  ammonia: {
    description:
      'Measures ammonia in blood, a waste substance formed during protein breakdown.',
    sources: ['https://medlineplus.gov/lab-tests/ammonia-levels/'],
  },
  zinc: {
    description:
      'Measures zinc, an essential trace element, in the blood sample.',
    sources: ['https://www.mayocliniclabs.com/test-catalog/overview/7735'],
  },
  copper: {
    description:
      'Measures copper, a trace element carried in blood mainly by proteins.',
    sources: ['https://www.mayocliniclabs.com/test-catalog/Overview/616155'],
  },
  selenium: {
    description:
      'Measures selenium, an essential trace element, in the sample.',
    sources: ['https://www.nwlpathology.nhs.uk/test/selenium/'],
  },
  vitamin_b6: {
    description:
      "Measures vitamin B6 in the sample, commonly as pyridoxal-5'-phosphate (PLP), its active form.",
    sources: [
      'https://www.nwlpathology.nhs.uk/test/vitamin-b6/',
      'https://pathology.uhsussex.nhs.uk/pug/biochemistry-immunology/biochemistry-tests/193-vitamin-b6',
    ],
  },
  vitamin_a: {
    description:
      'Measures retinol, the vitamin A form commonly tested in blood.',
    sources: ['https://www.mayocliniclabs.com/test-catalog/Overview/605267'],
  },
  vitamin_e: {
    description: 'Measures vitamin E in blood, usually as alpha-tocopherol.',
    sources: ['https://www.mayocliniclabs.com/test-catalog/Overview/605267'],
  },
  pth: {
    description:
      'Measures parathyroid hormone (PTH), which helps regulate calcium in blood.',
    sources: [
      'https://medlineplus.gov/lab-tests/parathyroid-hormone-pth-test/',
    ],
  },
  igf_1: {
    description:
      'Measures insulin-like growth factor 1 (IGF-1), a hormone involved in growth responses to growth hormone.',
    sources: [
      'https://medlineplus.gov/lab-tests/igf-1-insulin-like-growth-factor-1-test/',
    ],
  },
  dhea_s: {
    description:
      'Measures dehydroepiandrosterone sulphate (DHEA-S), a hormone made mainly by the adrenal glands.',
    sources: ['https://medlineplus.gov/lab-tests/dhea-sulfate-test/'],
  },
  free_testosterone: {
    description:
      'Reports the amount of testosterone that is not bound to proteins in blood.',
    sources: ['https://medlineplus.gov/lab-tests/testosterone-levels-test/'],
  },
  shbg: {
    description:
      'Measures sex hormone-binding globulin (SHBG), a blood protein that binds hormones including testosterone and oestrogen.',
    sources: ['https://medlineplus.gov/lab-tests/shbg-blood-test/'],
  },
  fsh: {
    description:
      'Measures follicle-stimulating hormone (FSH), a pituitary hormone involved in egg development and sperm production.',
    sources: [
      'https://medlineplus.gov/lab-tests/follicle-stimulating-hormone-fsh-levels-test/',
    ],
  },
  lh: {
    description:
      'Measures luteinising hormone (LH), a pituitary hormone involved in ovulation and testosterone production.',
    sources: [
      'https://medlineplus.gov/lab-tests/luteinizing-hormone-lh-levels-test/',
    ],
  },
  progesterone: {
    description:
      'Measures progesterone, a hormone involved in the menstrual cycle and pregnancy.',
    sources: ['https://medlineplus.gov/lab-tests/progesterone-test/'],
  },
  prolactin: {
    description:
      'Measures prolactin, a pituitary hormone involved in breast milk production.',
    sources: ['https://medlineplus.gov/lab-tests/prolactin-levels/'],
  },
  tpo_antibodies: {
    description:
      'Measures antibodies against thyroid peroxidase (TPO), an enzyme used to make thyroid hormones.',
    sources: [
      'https://www.nwlpathology.nhs.uk/test/thyroid-peroxidase-tpo-igg-antibodies/',
      'https://medlineplus.gov/lab-tests/thyroid-antibody-tests/',
    ],
  },
};
