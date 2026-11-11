export type ColType = 'text' | 'numbers' | 'status' | 'dropdown' | 'people' | 'date' | 'hour' | 'email' | 'phone' | 'link' | 'checkbox' | 'last_updated';
export type ViewType = 'table' | 'kanban' | 'calendar' | 'timeline' | 'chart';

export interface Label {
  id: number;
  name: string;
  color?: string;
}
export interface Column {
  id: string;
  title: string;
  type: ColType;
  width?: number;
  settings: { labels?: Label[]; unit?: string };
}
export interface FilterRule {
  columnId: string; // id de columna o '__group'
  values: (string | number)[];
}
export interface View {
  id: string;
  name: string;
  type: ViewType;
  settings: {
    columnId?: string;
    dateColumnId?: string;
    endDateColumnId?: string;
    filters?: FilterRule[];
    person?: string;
    sort?: { columnId: string; dir: 'asc' | 'desc' };
    hidden?: string[];
  };
}
export interface Group {
  id: string;
  board_id: string;
  title: string;
  color: string;
  position: number;
}
export interface Item {
  id: string;
  board_id: string;
  group_id: string;
  parent_id: string | null;
  name: string;
  position: number;
  vals: Record<string, any>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  updates_count: number;
}
export interface BoardMeta {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  position: number;
  items_count: number;
}
export interface Board extends BoardMeta {
  columns: Column[];
  subitem_columns: Column[];
  views: View[];
  groups: Group[];
  items: Item[];
}
export interface User {
  id: string;
  name: string;
  email: string | null;
  color: string;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
}
export interface Boot {
  users: User[];
  workspaces: Workspace[];
  boards: BoardMeta[];
}
export interface Update {
  id: string;
  item_id: string;
  user_id: string | null;
  user_name: string | null;
  body: string;
  created_at: string;
}
export interface Activity {
  id: number;
  item_id: string | null;
  item_name: string | null;
  user_id: string | null;
  kind: string;
  data: any;
  created_at: string;
}

export interface Actions {
  setVal(item: Item, colId: string, value: any): void;
  patchItem(id: string, patch: Partial<Pick<Item, 'name' | 'group_id' | 'position'>>): void;
  addItem(groupId: string, name: string, opts?: { parentId?: string; vals?: Record<string, any>; top?: boolean }): void;
  batch(ids: string[], action: 'delete' | 'move' | 'duplicate', groupId?: string): void;
  addGroup(top?: boolean): void;
  patchGroup(id: string, patch: Partial<Pick<Group, 'title' | 'color'>>): void;
  deleteGroup(id: string): void;
  addColumn(type: ColType, sub?: boolean): void;
  patchColumn(id: string, patch: Partial<Column>, sub?: boolean): void;
  deleteColumn(id: string, sub?: boolean): void;
  setViews(views: View[]): void;
  patchView(id: string, settings: Partial<View['settings']>): void;
  patchBoard(patch: { name?: string; description?: string }): void;
  openItem(id: string | null): void;
  bumpUpdates(itemId: string, delta: number): void;
}
