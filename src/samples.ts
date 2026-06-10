export interface SampleScan {
  id: string;
  name: string;
  type: "Glioma" | "Meningioma" | "Pituitary" | "No Tumor";
  plane: "axial" | "coronal" | "sagittal";
  description: string;
  svgData: string;
}

// Custom SVG drawings mimicking MRI brain scans in dark radiological mode
export const SAMPLE_SCANS: SampleScan[] = [
  {
    id: "sample_normal",
    name: "Patient Scan #5021 - Unremarkable (Healthy)",
    type: "No Tumor",
    plane: "axial",
    description: "Symmetric cerebral hemispheres, intact ventricles, clear sulcal spaces, no mass lesion.",
    svgData: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" style="background:#090d16; font-family:monospace;">
      <!-- Outer scan label -->
      <text x="10" y="20" fill="#4a5568" font-size="8">T2-weighted Axial</text>
      <text x="10" y="32" fill="#4a5568" font-size="8">ID: 5021-NORMAL</text>
      
      <!-- Skull border -->
      <ellipse cx="100" cy="100" rx="72" ry="85" fill="#111827" stroke="#374151" stroke-width="3" />
      <ellipse cx="100" cy="100" rx="68" ry="81" fill="#020617" stroke="#1f2937" stroke-width="1.5" />
      
      <!-- Brain Matter (Hemispheres) -->
      <path d="M 100,24 C 60,25 38,55 38,100 C 38,145 60,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      <path d="M 100,24 C 140,25 162,55 162,100 C 162,145 140,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      
      <!-- Ventricles (Symmetrical deep cavities) -->
      <path d="M 97,75 C 80,75 82,95 96,115" fill="none" stroke="#000000" stroke-width="6" stroke-linecap="round" opacity="0.9" />
      <path d="M 103,75 C 120,75 118,95 104,115" fill="none" stroke="#000000" stroke-width="6" stroke-linecap="round" opacity="0.9" />
      
      <!-- Internal sulci lines -->
      <path d="M 60,50 L 80,60 M 60,90 L 80,90 M 60,130 L 80,120 M 140,50 L 120,60 M 140,90 L 120,90 M 140,130 L 120,120" stroke="#334155" stroke-width="2" stroke-linecap="round" opacity="0.5" />
      
      <!-- Posterior horns -->
      <circle cx="95" cy="130" r="4" fill="#000" />
      <circle cx="105" cy="130" r="4" fill="#000" />
      
      <!-- Midline division -->
      <line x1="100" y1="24" x2="100" y2="176" stroke="#475569" stroke-dasharray="3,3" stroke-width="1" />
    </svg>`
  },
  {
    id: "sample_glioma",
    name: "Patient Scan #1290 - Parenchymal Infiltration",
    type: "Glioma",
    plane: "axial",
    description: "Invasive, ill-defined intra-axial mass in left frontal parenchyma with focal edema.",
    svgData: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" style="background:#090d16; font-family:monospace;">
      <text x="10" y="20" fill="#4a5568" font-size="8">T2-FLAIR Axial</text>
      <text x="10" y="32" fill="#4a5568" font-size="8">ID: 1290-GLIOMA</text>
      
      <!-- Skull border -->
      <ellipse cx="100" cy="100" rx="72" ry="85" fill="#111827" stroke="#374151" stroke-width="3" />
      <ellipse cx="100" cy="100" rx="68" ry="81" fill="#020617" stroke="#1f2937" stroke-width="1.5" />
      
      <!-- Brain Matter (compressed on left side) -->
      <path d="M 100,24 C 55,25 35,55 35,100 C 35,145 55,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      <path d="M 100,24 C 140,25 162,55 162,100 C 162,145 140,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      
      <!-- Glioma Edema Halo (Fuzzy hyperintensity) -->
      <circle cx="70" cy="72" r="24" fill="#64748b" opacity="0.5" filter="blur(3px)" />
      <circle cx="70" cy="72" r="18" fill="#94a3b8" opacity="0.6" filter="blur(2px)" />
      <!-- High intensity tumor core -->
      <path d="M 62,60 Q 75,55 80,70 Q 82,85 70,82 Q 58,80 62,60" fill="#cbd5e1" opacity="0.9" stroke="#cbd5e1" stroke-width="1" filter="blur(1px)" />

      <!-- Ventricles squeezed and shifted to the right -->
      <path d="M 88,80 C 85,85 86,98 94,115" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" opacity="0.9" />
      <path d="M 105,73 C 122,73 120,93 106,113" fill="none" stroke="#000000" stroke-width="6" stroke-linecap="round" opacity="0.9" />
      
      <!-- Posterior horns -->
      <circle cx="95" cy="130" r="4" fill="#000" />
      <circle cx="107" cy="130" r="4" fill="#000" />
      
      <!-- Squeezed midline -->
      <path d="M 100,24 Q 96,65 92,100 T 100,176" fill="none" stroke="#475569" stroke-dasharray="3,3" stroke-width="1" />
    </svg>`
  },
  {
    id: "sample_meningioma",
    name: "Patient Scan #8843 - Extra-Axial Mass",
    type: "Meningioma",
    plane: "axial",
    description: "Crisp, extra-axial dural-based mass along the right parietal sinus margins.",
    svgData: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" style="background:#090d16; font-family:monospace;">
      <text x="10" y="20" fill="#4a5568" font-size="8">T1 Contrast Axial</text>
      <text x="10" y="32" fill="#4a5568" font-size="8">ID: 8843-MENINGIOMA</text>
      
      <!-- Skull border -->
      <ellipse cx="100" cy="100" rx="72" ry="85" fill="#111827" stroke="#374151" stroke-width="3" />
      <ellipse cx="100" cy="100" rx="68" ry="81" fill="#020617" stroke="#1f2937" stroke-width="1.5" />
      
      <!-- Brain Matter (Left and Right) -->
      <path d="M 100,24 C 60,25 38,55 38,100 C 38,145 60,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      <path d="M 100,24 C 135,25 156,55 156,100 C 156,145 135,175 100,176 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      
      <!-- Meningioma crisp mass attached to top right skull margin -->
      <path d="M 148,65 C 130,55 110,65 118,85 C 122,95 145,95 154,82 Z" fill="#e2e8f0" stroke="#f8fafc" stroke-width="1.5" />
      <!-- Dural Tail connection indicator -->
      <path d="M 152,48 C 152,55 146,65 148,65" fill="none" stroke="#f1f5f9" stroke-width="2.5" />
      
      <!-- Ventricles squeezed slightly locally -->
      <path d="M 97,75 C 80,75 82,95 96,115" fill="none" stroke="#000000" stroke-width="6" stroke-linecap="round" opacity="0.9" />
      <path d="M 101,77 C 114,77 114,94 102,112" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round" opacity="0.9" />
      
      <!-- Midline division -->
      <line x1="100" y1="24" x2="100" y2="176" stroke="#475569" stroke-dasharray="3,3" stroke-width="1" />
    </svg>`
  },
  {
    id: "sample_pituitary",
    name: "Patient Scan #3391 - Sellar/Suprasellar Expansion",
    type: "Pituitary",
    plane: "coronal",
    description: "Centrally located sellar mass displaying suprasellar extension (snowman sign).",
    svgData: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" style="background:#090d16; font-family:monospace;">
      <text x="10" y="20" fill="#4a5568" font-size="8">T1 Coronal Views</text>
      <text x="10" y="32" fill="#4a5568" font-size="8">ID: 3391-PITUITARY</text>
      
      <!-- Skull border -->
      <ellipse cx="100" cy="100" rx="72" ry="85" fill="#111827" stroke="#374151" stroke-width="3" />
      <ellipse cx="100" cy="100" rx="68" ry="81" fill="#020617" stroke="#1f2937" stroke-width="1.5" />
      
      <!-- Brain tissue (Left/Right hemispheres in coronal view) -->
      <path d="M 100,26 C 55,27 45,55 45,100 Q 45,150 100,165 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      <path d="M 100,26 C 145,27 155,55 155,100 Q 155,150 100,165 Z" fill="#1e293b" opacity="0.8" stroke="#475569" stroke-width="1" />
      
      <!-- Ventricles (Coronal butterfly slit cavities) -->
      <path d="M 90,70 L 98,90 L 92,105" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" />
      <path d="M 110,70 L 102,90 L 108,105" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" />

      <!-- Pituitary Sellar Mass (Center base skull, Snowman contour) -->
      <!-- Lower dome -->
      <ellipse cx="100" cy="132" rx="16" ry="14" fill="#cbd5e1" stroke="#f1f5f9" stroke-width="1" />
      <!-- Upper dome - snowman silhouette -->
      <ellipse cx="100" cy="116" rx="11" ry="11" fill="#cbd5e1" stroke="#f1f5f9" stroke-width="1" />
      
      <!-- Optic Chiasm reference bar above pituitary -->
      <path d="M 82,98 C 95,95 105,95 118,98" fill="none" stroke="#475569" stroke-width="2.5" />
      
      <!-- Center vertical axis marker -->
      <line x1="100" y1="26" x2="100" y2="165" stroke="#4b5563" stroke-dasharray="2,4" stroke-width="0.75" />
    </svg>`
  }
];

// Simple helper to convert an inline SVG string directly to a Data URL
export function getSvgDataUrl(svgString: string): string {
  const cleaned = svgString.replace(/\n\s*/g, " ");
  return `data:image/svg+xml;utf8,${encodeURIComponent(cleaned)}`;
}
