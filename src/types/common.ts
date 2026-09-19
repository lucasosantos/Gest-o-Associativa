export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface PaginationParams {
  search?: string;
  page?: number;
  perPage?: number;
}
