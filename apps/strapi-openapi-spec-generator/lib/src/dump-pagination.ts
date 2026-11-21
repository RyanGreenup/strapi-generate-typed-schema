const pageSize = 100;

interface PageState {
  size?: number;
  count?: number;
  total?: number;
}

interface PagePosition {
  page: number;
  length: number;
  received: number;
  route: string;
}

interface ReportedPosition {
  reportedPage: number | undefined;
  start: number | undefined;
  limit: number | undefined;
  size: number;
}

const numeric = (
  pagination: Record<string, unknown>,
  key: string,
  route: string,
): number | undefined => {
  const value = pagination[key];
  if (value === undefined) {
    return value;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${route}: invalid pagination.${key}`);
  }
  return value;
};

const checkPosition = (
  { reportedPage, start, limit, size }: ReportedPosition,
  previousSize: number | undefined,
  { page, length, route }: PagePosition,
): void => {
  if (
    size === 0 ||
    length > size ||
    (limit !== undefined && limit !== size) ||
    (previousSize !== undefined && size !== previousSize) ||
    (reportedPage !== undefined && reportedPage !== page) ||
    (start !== undefined && start !== (page - 1) * size)
  ) {
    throw new Error(
      `${route}: inconsistent pagination size or position on page ${page}`,
    );
  }
};

const pageComplete = (
  count: number | undefined,
  size: number,
  { page, length, route }: PagePosition,
): boolean => {
  if (count === undefined) {
    return length < size;
  }
  if (
    page > Math.max(1, count) ||
    (count === 0 && length > 0) ||
    (length === 0 && !(page === 1 && count <= 1))
  ) {
    throw new Error(
      `${route}: unexpected data length on pagination page ${page}`,
    );
  }
  return page >= count;
};

interface PageCounts {
  total: number | undefined;
  count: number | undefined;
  fromTotal: number | undefined;
}

const checkCounts = (
  { total, count, fromTotal }: PageCounts,
  state: PageState,
  { page, route }: PagePosition,
): void => {
  if (
    (state.total !== undefined && total !== state.total) ||
    (state.count !== undefined && count !== state.count) ||
    (fromTotal !== undefined &&
      count !== fromTotal &&
      !(total === 0 && count === 1))
  ) {
    throw new Error(`${route}: inconsistent pagination counts on page ${page}`);
  }
};

const lastPage = (
  pagination: Record<string, unknown>,
  state: PageState,
  position: PagePosition,
): boolean => {
  const { page, received, route } = position;
  const reportedPage = numeric(pagination, "page", route);
  const start = numeric(pagination, "start", route);
  const limit = numeric(pagination, "limit", route);
  const size = numeric(pagination, "pageSize", route) ?? limit ?? pageSize;
  const total = numeric(pagination, "total", route) ?? state.total;
  const fromTotal = total === undefined ? undefined : Math.ceil(total / size);
  const count =
    numeric(pagination, "pageCount", route) ?? state.count ?? fromTotal;
  checkPosition({ reportedPage, start, limit, size }, state.size, position);
  checkCounts({ total, count, fromTotal }, state, position);
  const last = pageComplete(count, size, position);
  if (total !== undefined && (last ? received !== total : received >= total)) {
    throw new Error(`${route}: inconsistent pagination total on page ${page}`);
  }
  state.size = size;
  if (count !== undefined) {
    state.count = count;
  }
  if (total !== undefined) {
    state.total = total;
  }
  return last;
};

export { lastPage, pageSize };
export type { PagePosition, PageState };
