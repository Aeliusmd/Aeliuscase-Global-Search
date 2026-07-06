/**
 * Official injured body-part IDs, sourced from docs/bodyparts.xlsx (backend
 * reference list). The API's `bodyPartIds` param expects the spreadsheet's
 * own sequential ID column (1, 2, 3, ...) — NOT the legacy 3-digit code shown
 * in its "Body part" text (100, 110, 120...), which is just a display code.
 * The legacy code is kept in each entry's comment below for traceability only.
 */
export const BODY_PART_CODES: { code: number; label: string }[] = [
  { code: 1, label: 'Head' },                          // legacy 100
  { code: 2, label: 'Brain' },                          // legacy 110
  { code: 3, label: 'Ear' },                            // legacy 120
  { code: 4, label: 'Ear-external' },                   // legacy 121
  { code: 5, label: 'Ear-internal/hearing' },           // legacy 124
  { code: 6, label: 'Eye' },                            // legacy 130
  { code: 7, label: 'Face' },                           // legacy 140
  { code: 8, label: 'Jaw' },                            // legacy 141
  { code: 9, label: 'Mouth' },                          // legacy 144
  { code: 10, label: 'Teeth' },                         // legacy 145
  { code: 11, label: 'Nose' },                          // legacy 146
  { code: 12, label: 'Face-multiple' },                 // legacy 148
  { code: 13, label: 'Face-forehead/cheeks/eyelids' },  // legacy 149
  { code: 14, label: 'Scalp' },                         // legacy 150
  { code: 15, label: 'Skull' },                         // legacy 160
  { code: 16, label: 'Head-multiple' },                 // legacy 198
  { code: 17, label: 'Neck' },                          // legacy 200
  { code: 18, label: 'Upper extremities' },             // legacy 300
  { code: 19, label: 'Arm-above wrist' },               // legacy 310
  { code: 20, label: 'Arm-upper/humerus' },             // legacy 311
  { code: 21, label: 'Arm-elbow/radius' },              // legacy 313
  { code: 22, label: 'Arm-forearm' },                   // legacy 315
  { code: 23, label: 'Arm-multiple' },                  // legacy 318
  { code: 24, label: 'Arm-unspecified' },                // legacy 319
  { code: 25, label: 'Wrist' },                         // legacy 320
  { code: 26, label: 'Hand' },                          // legacy 330
  { code: 27, label: 'Fingers' },                       // legacy 340
  { code: 28, label: 'Upper extremities-multiple' },    // legacy 398
  { code: 29, label: 'Trunk' },                         // legacy 400
  { code: 30, label: 'Abdomen/groin' },                 // legacy 410
  { code: 31, label: 'Hernia' },                        // legacy 411
  { code: 32, label: 'Back/spine' },                    // legacy 420
  { code: 33, label: 'Chest/ribs' },                    // legacy 430
  { code: 34, label: 'Hips/pelvis' },                   // legacy 440
  { code: 35, label: 'Shoulders' },                     // legacy 450
  { code: 36, label: 'Trunk-multiple' },                // legacy 498
  { code: 37, label: 'Lower extremities' },             // legacy 500
  { code: 38, label: 'Legs-above ankle' },              // legacy 510
  { code: 39, label: 'Thigh' },                         // legacy 511
  { code: 40, label: 'Knee' },                          // legacy 513
  { code: 41, label: 'Lower leg' },                     // legacy 515
  { code: 42, label: 'Leg-multiple' },                  // legacy 518
  { code: 43, label: 'Leg-unspecified' },                // legacy 519
  { code: 44, label: 'Ankle' },                         // legacy 520
  { code: 45, label: 'Foot' },                          // legacy 530
  { code: 46, label: 'Toes' },                          // legacy 540
  { code: 47, label: 'Lower extremities-multiple' },    // legacy 598
  { code: 48, label: 'Multiple major parts' },          // legacy 700
  { code: 49, label: 'Body system-unspecified' },       // legacy 800
  { code: 50, label: 'Circulatory system' },            // legacy 801
  { code: 51, label: 'Heart attack' },                  // legacy 802
  { code: 52, label: 'Digestive system' },              // legacy 810
  { code: 53, label: 'Excretory system' },              // legacy 820
  { code: 54, label: 'Musculoskeletal system' },        // legacy 830
  { code: 55, label: 'Nervous system' },                // legacy 840
  { code: 56, label: 'Nervous system-stress' },         // legacy 841
  { code: 57, label: 'Nervous system-psychiatric' },    // legacy 842
  { code: 58, label: 'Respiratory system' },            // legacy 850
  { code: 59, label: 'Skin' },                          // legacy 860
  { code: 60, label: 'Reproductive system' },           // legacy 870
  { code: 61, label: 'Other body system' },             // legacy 880
  { code: 62, label: 'COVID-19' },                      // legacy 900
  { code: 63, label: 'Unclassified' },                  // legacy 999
];

export const BODY_PART_IDS_TEXT = BODY_PART_CODES.map((p) => `${p.code}=${p.label}`).join(', ');
