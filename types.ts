export type Listing = {
  id: string;
  title: string;
  url: string;
  price: number | null;
  priceText: string | null;
};

/**
 * A regex source string. Matching is case-insensitive and diacritic-insensitive,
 * so "kuciste" matches "kućište" and vice versa.
 */
export type Pattern = string;

/** One pattern, or a list of alternatives where any single match satisfies the group. */
export type Group = Pattern | Pattern[];

export type Search = {
  name: string;
  /** Search URL copied from the browser, ideally sorted newest first. */
  url: string;
  /** How many result pages to walk. Default 1. */
  pages?: number;

  /** Every group must match the title. Within a group, any alternative suffices. */
  all?: Group[];
  /** At least one group must match the title. */
  any?: Group[];
  /** No group may match the title. */
  none?: Group[];

  price?: {
    min?: number;
    max?: number;
    /** Drop listings with no parseable price. Default false, so they pass through. */
    required?: boolean;
  };

  /** Escape hatch for anything the declarative fields cannot express. */
  match?: (listing: Listing) => boolean;
};
