-- Insert AI Review phase
INSERT INTO "Phase" (
    "id",
    "name",
    "description",
    "isOpen",
    "duration",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
) VALUES (
    'c3a4d5e6-f7b8-4c9d-a0e1-2b3c4d5e6f7a',
    'AI Review',
    'AI Review Phase',
    true,
    86400,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;

-- Insert AI Only Challenge timeline template
INSERT INTO "TimelineTemplate" (
    "id",
    "name",
    "description",
    "isActive",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
) VALUES (
    'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
    'AI Only Challenge',
    'AI-Only Challenge Timeline',
    true,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;

-- Insert TimelineTemplatePhase entries for the AI Only Challenge template
-- Registration phase (no predecessor)
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
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
    'a93544bc-c165-4af4-b55e-18f3593b457a',
    NULL,
    432000,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;

-- Submission phase (predecessor: Registration)
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
    'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
    '6950164f-3c5e-4bdc-abc8-22aaf5a1bd49',
    'a93544bc-c165-4af4-b55e-18f3593b457a',
    432000,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;

-- AI Review phase (predecessor: Submission)
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
    'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
    'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
    'c3a4d5e6-f7b8-4c9d-a0e1-2b3c4d5e6f7a',
    '6950164f-3c5e-4bdc-abc8-22aaf5a1bd49',
    86400,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;
