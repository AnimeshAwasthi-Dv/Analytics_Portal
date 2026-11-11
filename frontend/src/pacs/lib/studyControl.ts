export type StudyControlUpdate = {
  processingJobId: null;
  processingJob: null;
  workflowStatus: string;
  autoSubmitAt: null;
  autoSubmitBlocked: true;
  submittedAt: null;
  selectedAt: null;
  updatedAt: string;
};

export function applyStudyControl<T extends { id: string }>(studies: T[], id: string, remove: boolean, update: StudyControlUpdate): T[] {
  return remove ? studies.filter(study => study.id !== id) : studies.map(study => study.id === id ? { ...study, ...update } : study);
}
