-- Add Approval phase to AI Only Challenge timeline template
-- Approval phase (predecessor: AI Review)
-- Default duration: 43200 seconds (12 hours), configurable
INSERT INTO "TimelineTemplatePhase" (
    "id",
    "timelineTemplateId",
    "phaseId",
    "predecessor",
    "defaultDuration",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
) VALUES (
    'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
    'ad985cff-ad3e-44de-b54e-3992505ba0ae',
    'c3a4d5e6-f7b8-4c9d-a0e1-2b3c4d5e6f7a',
    43200,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;
