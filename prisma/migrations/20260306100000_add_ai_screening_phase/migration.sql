-- Insert AI Screening phase
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
    '9f4e3b2a-7c1d-4e9f-b8a6-5d3c1a9f2b4e',
    'AI Screening',
    'AI Screening Phase',
    true,
    14400,
    '2025-03-10T13:08:02.378Z',
    'topcoder user',
    '2025-03-10T13:08:02.378Z',
    'topcoder user'
)
ON CONFLICT DO NOTHING;
