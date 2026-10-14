import { useEffect, useState } from 'react';
import { createStarterProject, STORAGE_KEY } from '../data/starterProject';
import { isProject } from '../utils/project';
import type { Project } from '../types';

function loadProject(): Project {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    return isProject(parsed) ? parsed : createStarterProject();
  } catch {
    return createStarterProject();
  }
}

/** Keeps the current scene in this browser without sending data anywhere. */
export function useProjectStorage() {
  const [project, setProject] = useState<Project>(loadProject);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  return [project, setProject] as const;
}
