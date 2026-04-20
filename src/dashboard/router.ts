import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import HomePage from './pages/HomePage.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
  },
  {
    path: '/project/:id',
    name: 'project',
    component: () => import('./pages/ProjectPage.vue'),
  },
  {
    path: '/project/:id/extension/:extId',
    name: 'competitorExtension',
    component: () => import('./pages/CompetitorExtensionPage.vue'),
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('./pages/LogsPage.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./pages/SettingsPage.vue'),
  },
  {
    path: '/rank-changes',
    name: 'rankChanges',
    component: () => import('./pages/RankChangesPage.vue'),
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
