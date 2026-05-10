// Mock data for DPP-Plattform demo
// Persistiert via localStorage; Reset im Topbar-Menu moeglich.

export const LOOKUPS = {
  organization_type: [
    { value: 'brand',              label: 'Brand / Inverkehrbringer' },
    { value: 'manufacturer',       label: 'Konfektionaer (Tier 1)' },
    { value: 'supplier',           label: 'Vorlieferant (Tier 2+)' },
    { value: 'distributor',        label: 'Distributor / Grosshandel' },
    { value: 'retailer',           label: 'Retailer / Einzelhandel' },
    { value: 'logistics_provider', label: 'Logistik' },
    { value: 'recycler',           label: 'Recycler' },
    { value: 'repair_service',     label: 'Reparaturdienst' },
    { value: 'certifier',          label: 'Zertifizierungsstelle' },
    { value: 'authority',          label: 'Behoerde / Marktaufsicht' }
  ],
  granularity_level: [
    { value: 'model', label: 'Modell / SKU' },
    { value: 'batch', label: 'Batch / Charge' },
    { value: 'item',  label: 'Einzelstueck (Item)' }
  ],
  dpp_status: [
    { value: 'draft',      label: 'Entwurf' },
    { value: 'published',  label: 'Veroeffentlicht' },
    { value: 'superseded', label: 'Ersetzt' },
    { value: 'archived',   label: 'Archiviert' }
  ],
  visibility: [
    { value: 'public',         label: 'Oeffentlich (Konsument)' },
    { value: 'restricted',     label: 'Eingeschraenkt (B2B)' },
    { value: 'internal',       label: 'Intern' },
    { value: 'authority_only', label: 'Nur Behoerden' }
  ],
  verification_status: [
    { value: 'declared',             label: 'Selbsterklaerung' },
    { value: 'documented',           label: 'Dokumentiert' },
    { value: 'third_party_verified', label: 'Drittstellen-verifiziert' }
  ],
  material_class: [
    { value: 'natural_plant',  label: 'Pflanzlich (Cotton, Linen, Hemp)' },
    { value: 'natural_animal', label: 'Tierisch (Wool, Silk)' },
    { value: 'synthetic',      label: 'Synthetisch (Polyester, Polyamide)' },
    { value: 'regenerated',    label: 'Regeneriert (Viscose, Lyocell)' },
    { value: 'recycled',       label: 'Recycelt (rPET, recycled cotton)' },
    { value: 'bio_based',      label: 'Bio-basiert' },
    { value: 'metal',          label: 'Metallisch' },
    { value: 'other',          label: 'Sonstiges' }
  ],
  compliance_standard: [
    { value: 'ESPR',                 label: 'ESPR (EU Ecodesign)' },
    { value: 'EU_Textile_Labelling', label: 'EU Textilkennzeichnung' },
    { value: 'REACH',                label: 'REACH (Chemikalien)' },
    { value: 'CSDDD',                label: 'CSDDD (Lieferkette)' },
    { value: 'CSRD',                 label: 'CSRD (Reporting)' },
    { value: 'AGEC_FR',              label: 'AGEC (Frankreich)' },
    { value: 'GOTS',                 label: 'GOTS (freiwillig)' },
    { value: 'OEKO_TEX',             label: 'OEKO-TEX (freiwillig)' }
  ],
  document_type: [
    { value: 'certificate',    label: 'Zertifikat' },
    { value: 'audit_report',   label: 'Audit-Bericht' },
    { value: 'test_report',    label: 'Pruefbericht' },
    { value: 'declaration',    label: 'Konformitaetserklaerung' },
    { value: 'safety_sheet',   label: 'Sicherheitsdatenblatt' }
  ]
};

// Initial-Stammdaten — werden bei erstem Start in localStorage gelegt.
export const SEED = {

  organizations: [
    { id: 'org-001', legal_name: 'Greenline Apparel GmbH', trade_name: 'Greenline',     organization_type: 'brand',        country_iso2: 'DE', city: 'Muenchen',  gln: '4012345000009', is_platform_tenant: true },
    { id: 'org-002', legal_name: 'Porto Confeccao SA',     trade_name: 'Porto Confeccao', organization_type: 'manufacturer', country_iso2: 'PT', city: 'Porto',     gln: '5601234500003', is_platform_tenant: true },
    { id: 'org-003', legal_name: 'Istanbul Knit Ltd',      trade_name: 'IK Knit',       organization_type: 'manufacturer', country_iso2: 'TR', city: 'Istanbul',  gln: '8690011001008', is_platform_tenant: true },
    { id: 'org-004', legal_name: 'Egyptian Cotton Co-op',  trade_name: 'EgyCotton',     organization_type: 'supplier',     country_iso2: 'EG', city: 'Alexandria',gln: '6213450000004', is_platform_tenant: false },
    { id: 'org-005', legal_name: 'BAuA Marktaufsicht',     trade_name: '',              organization_type: 'authority',    country_iso2: 'DE', city: 'Dortmund',  gln: '',              is_platform_tenant: true }
  ],

  facilities: [
    { id: 'fac-001', organization_id: 'org-001', name: 'Greenline HQ Lager',     facility_type: 'warehouse',       country_iso2: 'DE', region: 'Bayern',   gln: '4012345001003', latitude: 48.137, longitude: 11.575, audit_status: '',       last_audit_date: '' },
    { id: 'fac-002', organization_id: 'org-002', name: 'Werk Porto',             facility_type: 'garment_factory', country_iso2: 'PT', region: 'Porto',    gln: '5601234501000', latitude: 41.149, longitude: -8.610, audit_status: 'SMETA',  last_audit_date: '2025-09-12' },
    { id: 'fac-003', organization_id: 'org-003', name: 'Knit Plant Istanbul',    facility_type: 'knitting_mill',   country_iso2: 'TR', region: 'Istanbul', gln: '8690011002005', latitude: 41.008, longitude: 28.978, audit_status: 'BSCI',   last_audit_date: '2025-11-04' },
    { id: 'fac-004', organization_id: 'org-004', name: 'Cotton Farm Nile-Delta', facility_type: 'farm',            country_iso2: 'EG', region: 'Damietta', gln: '',              latitude: 31.420, longitude: 31.815, audit_status: '',       last_audit_date: '' }
  ],

  products: [
    { id: 'prd-001', name: 'Crew T-Shirt Organic',   gtin: '04012345678901', category: 'tops',     owning_organization_id: 'org-001' },
    { id: 'prd-002', name: 'Hoodie Recycled Blend',  gtin: '04012345678918', category: 'outerwear',owning_organization_id: 'org-001' },
    { id: 'prd-003', name: 'Five-Pocket Jeans',      gtin: '04012345678925', category: 'bottoms',  owning_organization_id: 'org-001' },
    { id: 'prd-004', name: 'Merino Crew Socks',      gtin: '04012345678932', category: 'accessories', owning_organization_id: 'org-001' },
    { id: 'prd-005', name: 'Cable-Knit Pullover',    gtin: '04012345678949', category: 'tops',     owning_organization_id: 'org-001' }
  ],

  users: [
    { id: 'usr-001', email: 'a.huber@greenline.example',  display_name: 'Anna Huber',    organization_id: 'org-001', role: 'admin' },
    { id: 'usr-002', email: 'm.silva@greenline.example',  display_name: 'Miguel Silva',  organization_id: 'org-001', role: 'dpp_editor' },
    { id: 'usr-003', email: 'p.castro@portoconf.example', display_name: 'Paula Castro',  organization_id: 'org-002', role: 'dpp_editor' },
    { id: 'usr-004', email: 'b.audit@baua.example',       display_name: 'Bernd Audit',   organization_id: 'org-005', role: 'authority' }
  ],

  dpps: [
    {
      id: 'dpp-001',
      product_id: 'prd-001',
      issuing_organization_id: 'org-001',
      facility_id: 'fac-002',
      granularity_level: 'batch',
      gtin: '04012345678901',
      batch_lot_number: 'B2026-A0142',
      serial_number: '',
      status: 'published',
      visibility: 'public',
      manufacturing_country_iso2: 'PT',
      manufacturing_date_from: '2026-02-01',
      manufacturing_date_to:   '2026-02-28',
      placed_on_market_date:   '2026-04-15',
      verification_status: 'documented',
      qr_payload_url: 'https://dpp.greenline.example/p/dpp-001',
      created_at: '2026-03-10T08:30:00Z',
      created_by: 'usr-002',
      updated_at: '2026-04-12T15:20:00Z',
      published_at: '2026-04-15T09:00:00Z',
      material_composition: [
        { id: 'mat-1', material_class: 'natural_plant', fiber_name: 'Organic Cotton', percentage: 80, country_of_origin: 'EG', recycled_content_pct: 0, verification_status: 'documented' },
        { id: 'mat-2', material_class: 'recycled',      fiber_name: 'Recycled Polyester', percentage: 20, country_of_origin: 'TR', recycled_content_pct: 100, verification_status: 'documented' }
      ],
      compliance_statements: [
        { id: 'cmp-1', compliance_standard: 'ESPR',                statement_text: 'Erfuellt die ESPR-Anforderungen fuer Textilien.', valid_from: '2026-04-15', valid_until: '2031-04-14', verification_status: 'declared' },
        { id: 'cmp-2', compliance_standard: 'EU_Textile_Labelling',statement_text: 'Faserzusammensetzung gemaess Verordnung (EU) Nr. 1007/2011.', valid_from: '2026-04-15', valid_until: '', verification_status: 'declared' },
        { id: 'cmp-3', compliance_standard: 'OEKO_TEX',            statement_text: 'OEKO-TEX Standard 100, Klasse II.', valid_from: '2025-08-01', valid_until: '2026-07-31', verification_status: 'third_party_verified' }
      ],
      documents: [
        { id: 'doc-1', document_type: 'certificate',  title: 'OEKO-TEX 100 Zertifikat', file_name: 'oekotex_2025.pdf',  issuer: 'OEKO-TEX Service GmbH', issued_at: '2025-08-01', visibility: 'public' },
        { id: 'doc-2', document_type: 'declaration',  title: 'EU-Konformitaetserklaerung', file_name: 'eu_decl_2026.pdf', issuer: 'Greenline Apparel GmbH', issued_at: '2026-04-15', visibility: 'public' },
        { id: 'doc-3', document_type: 'audit_report', title: 'SMETA-Audit Werk Porto', file_name: 'smeta_porto_2025.pdf', issuer: 'Sedex', issued_at: '2025-09-12', visibility: 'restricted' }
      ]
    },
    {
      id: 'dpp-002',
      product_id: 'prd-002',
      issuing_organization_id: 'org-001',
      facility_id: 'fac-003',
      granularity_level: 'batch',
      gtin: '04012345678918',
      batch_lot_number: 'B2026-H0023',
      serial_number: '',
      status: 'published',
      visibility: 'public',
      manufacturing_country_iso2: 'TR',
      manufacturing_date_from: '2026-01-10',
      manufacturing_date_to:   '2026-02-05',
      placed_on_market_date:   '2026-03-01',
      verification_status: 'declared',
      qr_payload_url: 'https://dpp.greenline.example/p/dpp-002',
      created_at: '2026-02-08T14:10:00Z',
      created_by: 'usr-002',
      updated_at: '2026-02-25T11:45:00Z',
      published_at: '2026-03-01T08:00:00Z',
      material_composition: [
        { id: 'mat-1', material_class: 'recycled',      fiber_name: 'Recycled Polyester', percentage: 70, country_of_origin: 'TR', recycled_content_pct: 100, verification_status: 'documented' },
        { id: 'mat-2', material_class: 'natural_plant', fiber_name: 'Cotton',             percentage: 30, country_of_origin: 'IN', recycled_content_pct: 0,   verification_status: 'declared'   }
      ],
      compliance_statements: [
        { id: 'cmp-1', compliance_standard: 'ESPR',  statement_text: 'Erfuellt die ESPR-Anforderungen fuer Textilien.', valid_from: '2026-03-01', valid_until: '2031-02-28', verification_status: 'declared' },
        { id: 'cmp-2', compliance_standard: 'REACH', statement_text: 'Keine SVHC-Substanzen >0,1% im Produkt.', valid_from: '2026-03-01', valid_until: '', verification_status: 'declared' }
      ],
      documents: [
        { id: 'doc-1', document_type: 'declaration', title: 'REACH-Konformitaetserklaerung', file_name: 'reach_2026.pdf', issuer: 'Greenline Apparel GmbH', issued_at: '2026-03-01', visibility: 'public' }
      ]
    },
    {
      id: 'dpp-003',
      product_id: 'prd-003',
      issuing_organization_id: 'org-001',
      facility_id: 'fac-002',
      granularity_level: 'model',
      gtin: '04012345678925',
      batch_lot_number: '',
      serial_number: '',
      status: 'draft',
      visibility: 'internal',
      manufacturing_country_iso2: 'PT',
      manufacturing_date_from: '',
      manufacturing_date_to: '',
      placed_on_market_date: '',
      verification_status: 'declared',
      qr_payload_url: '',
      created_at: '2026-05-02T09:15:00Z',
      created_by: 'usr-002',
      updated_at: '2026-05-08T16:00:00Z',
      published_at: '',
      material_composition: [
        { id: 'mat-1', material_class: 'natural_plant', fiber_name: 'Cotton', percentage: 100, country_of_origin: 'EG', recycled_content_pct: 0, verification_status: 'declared' }
      ],
      compliance_statements: [],
      documents: []
    }
  ]
};
