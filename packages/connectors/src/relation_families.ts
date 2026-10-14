export type LinkFamily = 'mentions' | 'cites' | 'in_container' | 'thread';

export type ConnectorLinkMethod =
  | 'provider_native'
  | 'url_rule'
  | 'exact_ref'
  | 'wikilink'
  | 'runtime_provenance'
  | 'authored'
  | 'model_proposed'
  | 'human'
  | 'claim_receipt';

export type ConnectorRelationRecord = {
  relation: string;
  link_family: LinkFamily;
  inverse_relation: string | null;
  allowed_link_methods: readonly ConnectorLinkMethod[];
};

export type RelationFamilyLookup = ConnectorRelationRecord & { registered: boolean };

const header_methods: readonly ConnectorLinkMethod[] = [
  'provider_native',
  'authored',
  'human',
  'model_proposed',
];
const text_methods: readonly ConnectorLinkMethod[] = [
  'wikilink',
  'url_rule',
  'exact_ref',
  'runtime_provenance',
  ...header_methods,
];

function family_relation(
  relation: string,
  link_family: LinkFamily,
  allowed_link_methods: readonly ConnectorLinkMethod[],
): ConnectorRelationRecord {
  return { relation, link_family, inverse_relation: null, allowed_link_methods };
}

function person_relation(relation: string): ConnectorRelationRecord {
  return family_relation(relation, 'mentions', header_methods);
}

export const built_in_relation_records: readonly ConnectorRelationRecord[] = [
  family_relation('mentions', 'mentions', text_methods),
  family_relation('cites', 'cites', [...text_methods, 'claim_receipt']),
  family_relation('in_container', 'in_container', ['provider_native', 'authored', 'human']),
  family_relation('thread', 'thread', ['provider_native']),
  person_relation('about_person'),
  person_relation('owned_by'),
  person_relation('assignee'),
  person_relation('reporter'),
  person_relation('author'),
  person_relation('attendee'),
  person_relation('organizer'),
  person_relation('works_at'),
  person_relation('member_of_team'),
  family_relation('parent', 'in_container', header_methods),
  family_relation('reply_to', 'thread', header_methods),
  family_relation('related_to', 'mentions', text_methods),
  family_relation('replaces', 'cites', header_methods),
  family_relation('belongs_in', 'in_container', ['model_proposed']),
];

export function read_relation_family(
  records: readonly ConnectorRelationRecord[],
  relation: string,
): RelationFamilyLookup {
  const merged = new Map(
    [...built_in_relation_records, ...records].map((record) => [record.relation, record]),
  );
  const found = merged.get(relation);
  if (found) return { ...found, registered: true };
  return {
    relation,
    link_family: 'mentions',
    inverse_relation: null,
    allowed_link_methods: [],
    registered: false,
  };
}
