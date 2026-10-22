# DataGridWithFilters

The `DataGridWithFilters` component is a versatile and customizable table component designed to display and manage tabular data efficiently. It supports features such as sorting, filtering, pagination, and selection, making it suitable for a wide range of applications.

## Features

- **Customizable Columns**: Define the structure and appearance of each column.
- **Pagination**: Built-in support for paginating large datasets.
- **Sorting**: Enable sorting on one or multiple columns.
- **Search**: Quickly find data using the built-in search functionality.
- **Column filtering**: Apply filters to narrow down the displayed data.
- **Pagination**: Manage large datasets with built-in pagination controls.
- **Row Selection**: Support for single or multiple row selections.
- **Loading State**: Display a loading indicator when data is being fetched or processed.
- **Empty States**: Customizable messages for empty data scenarios.
- **Accessibility**: Built with accessibility best practices in mind.

## Controlled vs Uncontrolled

DataGridWithFilters features can be used in both controlled and uncontrolled modes. In controlled mode, the parent component manages the state of features like sorting, filtering, and pagination. In uncontrolled mode, the DataGridWithFilters component manages its own state internally.

### Pagination

When using controlled pagination (parent manages the pagination state), **all other features** must also be controlled. Without knowing the total number of items, DataGridWithFilters cannot accurately manage other features like sorting and filtering internally, so the parent component must handle these as well.

### Sorting

Sorting can only be controlled when pagination is also controlled. Use `paginationOptions.onSortChange` prop to manage sorting state externally.

### Search

Search can be controlled independently of pagination, though this is not recommended. Use `onSearch` prop to manage search state externally.

### Filtering

Column filtering can be controlled independently of pagination, though this is not recommended. Use `onFilterChange` prop on the column filter options to manage filtering state externally.

## Loading, empty, and no results states

The DataGridWithFilters component provides customizable empty and loading states to enhance the user experience.

### Loading state

When `isLoading` is true, a loading spinner is displayed instead of the table. The loading message can be customized using the `loadingMessage` prop.

### Empty state

When the items array is empty and there are no active search or filters, DataGridWithFilters displays an empty state. This can be customized using the `emptyState` prop, which accepts an object with `title` and `description` properties.

### No results state

When the items array is empty due to active search or filters, DataGridWithFilters displays a no results state. This can be customized using the `noResultsState` prop, which also accepts an object with `title` and `description` properties.

**If you are prefiltering your data before passing it to DataGridWithFilters, the `emptyState` will be shown whenever the prefiltered data is empty. The `noResultsState` will be shown whenever the prefiltered data is not empty, but the applied filters or search query result in no matching items.**
