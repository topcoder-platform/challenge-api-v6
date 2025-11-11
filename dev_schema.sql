--
-- PostgreSQL database dump
--

\restrict ybCAF7hqlau3z1Rkf7WLMILtRGkO00JHWyoZdUXMHCvn3yICl4WXr7TAHScGcI8

-- Dumped from database version 16.8
-- Dumped by pg_dump version 17.6 (Ubuntu 17.6-0ubuntu0.25.04.1)

-- Started on 2025-11-12 07:57:42 AEDT

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 17 (class 2615 OID 7338395)
-- Name: challenges; Type: SCHEMA; Schema: -; Owner: topcoder
--

CREATE SCHEMA challenges;


ALTER SCHEMA challenges OWNER TO topcoder;

--
-- TOC entry 1672 (class 1247 OID 7338868)
-- Name: ChallengeStatusEnum; Type: TYPE; Schema: challenges; Owner: topcoder
--

CREATE TYPE challenges."ChallengeStatusEnum" AS ENUM (
    'NEW',
    'DRAFT',
    'APPROVED',
    'ACTIVE',
    'COMPLETED',
    'DELETED',
    'CANCELLED',
    'CANCELLED_FAILED_REVIEW',
    'CANCELLED_FAILED_SCREENING',
    'CANCELLED_ZERO_SUBMISSIONS',
    'CANCELLED_WINNER_UNRESPONSIVE',
    'CANCELLED_CLIENT_REQUEST',
    'CANCELLED_REQUIREMENTS_INFEASIBLE',
    'CANCELLED_ZERO_REGISTRATIONS',
    'CANCELLED_PAYMENT_FAILED'
);


ALTER TYPE challenges."ChallengeStatusEnum" OWNER TO topcoder;

--
-- TOC entry 1691 (class 1247 OID 10092788)
-- Name: ChallengeTrackEnum; Type: TYPE; Schema: challenges; Owner: topcoder
--

CREATE TYPE challenges."ChallengeTrackEnum" AS ENUM (
    'DESIGN',
    'DATA_SCIENCE',
    'DEVELOPMENT',
    'QUALITY_ASSURANCE'
);


ALTER TYPE challenges."ChallengeTrackEnum" OWNER TO topcoder;

--
-- TOC entry 1669 (class 1247 OID 7338864)
-- Name: DiscussionTypeEnum; Type: TYPE; Schema: challenges; Owner: topcoder
--

CREATE TYPE challenges."DiscussionTypeEnum" AS ENUM (
    'CHALLENGE'
);


ALTER TYPE challenges."DiscussionTypeEnum" OWNER TO topcoder;

--
-- TOC entry 1675 (class 1247 OID 7338900)
-- Name: PrizeSetTypeEnum; Type: TYPE; Schema: challenges; Owner: topcoder
--

CREATE TYPE challenges."PrizeSetTypeEnum" AS ENUM (
    'PLACEMENT',
    'COPILOT',
    'REVIEWER',
    'CHECKPOINT'
);


ALTER TYPE challenges."PrizeSetTypeEnum" OWNER TO topcoder;

--
-- TOC entry 1346 (class 1247 OID 9448118)
-- Name: ReviewOpportunityTypeEnum; Type: TYPE; Schema: challenges; Owner: challenges
--

CREATE TYPE challenges."ReviewOpportunityTypeEnum" AS ENUM (
    'REGULAR_REVIEW',
    'COMPONENT_DEV_REVIEW',
    'SPEC_REVIEW',
    'ITERATIVE_REVIEW',
    'SCENARIOS_REVIEW'
);


ALTER TYPE challenges."ReviewOpportunityTypeEnum" OWNER TO challenges;

--
-- TOC entry 1680 (class 1247 OID 7338858)
-- Name: ReviewTypeEnum; Type: TYPE; Schema: challenges; Owner: challenges
--

CREATE TYPE challenges."ReviewTypeEnum" AS ENUM (
    'COMMUNITY',
    'INTERNAL',
    'SYSTEM',
    'PROVISIONAL',
    'EXAMPLE'
);


ALTER TYPE challenges."ReviewTypeEnum" OWNER TO challenges;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 402 (class 1259 OID 7338955)
-- Name: Attachment; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."Attachment" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    name text NOT NULL,
    "fileSize" integer NOT NULL,
    url text NOT NULL,
    description text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."Attachment" OWNER TO challenges;

--
-- TOC entry 401 (class 1259 OID 7338947)
-- Name: AuditLog; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."AuditLog" (
    id text NOT NULL,
    "challengeId" text,
    "fieldName" text NOT NULL,
    "oldValue" text,
    "newValue" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "memberId" text
);


ALTER TABLE challenges."AuditLog" OWNER TO challenges;

--
-- TOC entry 397 (class 1259 OID 7338909)
-- Name: Challenge; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."Challenge" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "privateDescription" text,
    "descriptionFormat" text,
    "projectId" integer,
    "typeId" text NOT NULL,
    "trackId" text NOT NULL,
    "timelineTemplateId" text,
    "overviewTotalPrizes" double precision,
    "currentPhaseNames" text[],
    tags text[],
    groups text[],
    "taskIsTask" boolean DEFAULT false NOT NULL,
    "taskIsAssigned" boolean DEFAULT false NOT NULL,
    "taskMemberId" text,
    "submissionStartDate" timestamp(3) without time zone,
    "submissionEndDate" timestamp(3) without time zone,
    "registrationStartDate" timestamp(3) without time zone,
    "registrationEndDate" timestamp(3) without time zone,
    "startDate" timestamp(3) without time zone,
    "endDate" timestamp(3) without time zone,
    "legacyId" integer,
    status challenges."ChallengeStatusEnum" DEFAULT 'NEW'::challenges."ChallengeStatusEnum" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL,
    "challengeSource" text,
    "wiproAllowed" boolean DEFAULT false NOT NULL,
    "numOfRegistrants" integer DEFAULT 0 NOT NULL,
    "numOfSubmissions" integer DEFAULT 0 NOT NULL,
    "numOfCheckpointSubmissions" integer DEFAULT 0 NOT NULL
);


ALTER TABLE challenges."Challenge" OWNER TO challenges;

--
-- TOC entry 408 (class 1259 OID 7339003)
-- Name: ChallengeBilling; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeBilling" (
    id text NOT NULL,
    "billingAccountId" text,
    markup double precision,
    "clientBillingRate" double precision,
    "challengeId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeBilling" OWNER TO challenges;

--
-- TOC entry 413 (class 1259 OID 7339050)
-- Name: ChallengeConstraint; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeConstraint" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "allowedRegistrants" text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeConstraint" OWNER TO challenges;

--
-- TOC entry 411 (class 1259 OID 7339034)
-- Name: ChallengeDiscussion; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeDiscussion" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "discussionId" text,
    name text NOT NULL,
    type challenges."DiscussionTypeEnum" NOT NULL,
    provider text NOT NULL,
    url text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeDiscussion" OWNER TO challenges;

--
-- TOC entry 412 (class 1259 OID 7339042)
-- Name: ChallengeDiscussionOption; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeDiscussionOption" (
    id text NOT NULL,
    "discussionId" text NOT NULL,
    "optionKey" text NOT NULL,
    "optionValue" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeDiscussionOption" OWNER TO challenges;

--
-- TOC entry 410 (class 1259 OID 7339026)
-- Name: ChallengeEvent; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeEvent" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "eventId" integer NOT NULL,
    name text,
    key text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeEvent" OWNER TO challenges;

--
-- TOC entry 409 (class 1259 OID 7339011)
-- Name: ChallengeLegacy; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeLegacy" (
    id text NOT NULL,
    "reviewType" challenges."ReviewTypeEnum" DEFAULT 'INTERNAL'::challenges."ReviewTypeEnum" NOT NULL,
    "confidentialityType" text DEFAULT 'public'::text NOT NULL,
    "forumId" integer,
    "directProjectId" integer,
    "screeningScorecardId" integer,
    "reviewScorecardId" integer,
    "isTask" boolean DEFAULT false NOT NULL,
    "useSchedulingAPI" boolean DEFAULT false NOT NULL,
    "pureV5Task" boolean DEFAULT false NOT NULL,
    "pureV5" boolean DEFAULT false NOT NULL,
    "selfService" boolean DEFAULT false NOT NULL,
    "selfServiceCopilot" text,
    track text,
    "subTrack" text,
    "legacySystemId" integer,
    "challengeId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeLegacy" OWNER TO challenges;

--
-- TOC entry 403 (class 1259 OID 7338963)
-- Name: ChallengeMetadata; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeMetadata" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    name text NOT NULL,
    value text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeMetadata" OWNER TO challenges;

--
-- TOC entry 415 (class 1259 OID 7339067)
-- Name: ChallengePhase; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengePhase" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "phaseId" text NOT NULL,
    name text NOT NULL,
    description text,
    "isOpen" boolean DEFAULT false,
    predecessor text,
    duration integer,
    "scheduledStartDate" timestamp(3) without time zone,
    "scheduledEndDate" timestamp(3) without time zone,
    "actualStartDate" timestamp(3) without time zone,
    "actualEndDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengePhase" OWNER TO challenges;

--
-- TOC entry 416 (class 1259 OID 7339076)
-- Name: ChallengePhaseConstraint; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengePhaseConstraint" (
    id text NOT NULL,
    "challengePhaseId" text NOT NULL,
    name text NOT NULL,
    value integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengePhaseConstraint" OWNER TO challenges;

--
-- TOC entry 417 (class 1259 OID 7339084)
-- Name: ChallengePrizeSet; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengePrizeSet" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    type challenges."PrizeSetTypeEnum" NOT NULL,
    description text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengePrizeSet" OWNER TO challenges;

--
-- TOC entry 596 (class 1259 OID 9374665)
-- Name: ChallengeReviewer; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeReviewer" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "scorecardId" text NOT NULL,
    "isMemberReview" boolean NOT NULL,
    "memberReviewerCount" integer,
    "phaseId" text NOT NULL,
    "baseCoefficient" double precision,
    "incrementalCoefficient" double precision,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL,
    type challenges."ReviewOpportunityTypeEnum",
    "aiWorkflowId" character varying(14),
    "shouldOpenOpportunity" boolean DEFAULT true NOT NULL,
    "fixedAmount" double precision DEFAULT 0
);


ALTER TABLE challenges."ChallengeReviewer" OWNER TO challenges;

--
-- TOC entry 407 (class 1259 OID 7338995)
-- Name: ChallengeSkill; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeSkill" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "skillId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeSkill" OWNER TO challenges;

--
-- TOC entry 406 (class 1259 OID 7338987)
-- Name: ChallengeTerm; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeTerm" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "termId" text NOT NULL,
    "roleId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeTerm" OWNER TO challenges;

--
-- TOC entry 400 (class 1259 OID 7338938)
-- Name: ChallengeTimelineTemplate; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeTimelineTemplate" (
    id text NOT NULL,
    "typeId" text NOT NULL,
    "trackId" text NOT NULL,
    "timelineTemplateId" text NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeTimelineTemplate" OWNER TO challenges;

--
-- TOC entry 399 (class 1259 OID 7338930)
-- Name: ChallengeTrack; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeTrack" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "isActive" boolean NOT NULL,
    abbreviation text NOT NULL,
    "legacyId" integer,
    track challenges."ChallengeTrackEnum",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeTrack" OWNER TO challenges;

--
-- TOC entry 398 (class 1259 OID 7338920)
-- Name: ChallengeType; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeType" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "isTask" boolean DEFAULT false NOT NULL,
    abbreviation text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeType" OWNER TO challenges;

--
-- TOC entry 405 (class 1259 OID 7338979)
-- Name: ChallengeWinner; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."ChallengeWinner" (
    id text NOT NULL,
    "challengeId" text NOT NULL,
    "userId" integer NOT NULL,
    handle text NOT NULL,
    placement integer NOT NULL,
    type challenges."PrizeSetTypeEnum" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."ChallengeWinner" OWNER TO challenges;

--
-- TOC entry 601 (class 1259 OID 9456535)
-- Name: DefaultChallengeReviewer; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."DefaultChallengeReviewer" (
    id text NOT NULL,
    "typeId" text NOT NULL,
    "trackId" text NOT NULL,
    "scorecardId" text NOT NULL,
    "isMemberReview" boolean NOT NULL,
    "memberReviewerCount" integer,
    "phaseName" text NOT NULL,
    "baseCoefficient" double precision,
    "incrementalCoefficient" double precision,
    "opportunityType" challenges."ReviewOpportunityTypeEnum",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL,
    "phaseId" text,
    "shouldOpenOpportunity" boolean DEFAULT true NOT NULL,
    "timelineTemplateId" text,
    "fixedAmount" double precision DEFAULT 0,
    "isAIReviewer" boolean
);


ALTER TABLE challenges."DefaultChallengeReviewer" OWNER TO challenges;

--
-- TOC entry 622 (class 1259 OID 11187472)
-- Name: MemberChallengeAccess; Type: VIEW; Schema: challenges; Owner: challenges
--

CREATE VIEW challenges."MemberChallengeAccess" AS
 SELECT DISTINCT "challengeId",
    "memberId"
   FROM resources."Resource" r
  WHERE (("challengeId" IS NOT NULL) AND ("memberId" IS NOT NULL));


ALTER VIEW challenges."MemberChallengeAccess" OWNER TO challenges;

--
-- TOC entry 414 (class 1259 OID 7339059)
-- Name: Phase; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."Phase" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "isOpen" boolean NOT NULL,
    duration integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."Phase" OWNER TO challenges;

--
-- TOC entry 404 (class 1259 OID 7338971)
-- Name: Prize; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."Prize" (
    id text NOT NULL,
    description text,
    "prizeSetId" text NOT NULL,
    type text NOT NULL,
    value double precision NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."Prize" OWNER TO challenges;

--
-- TOC entry 418 (class 1259 OID 7339092)
-- Name: TimelineTemplate; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."TimelineTemplate" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."TimelineTemplate" OWNER TO challenges;

--
-- TOC entry 419 (class 1259 OID 7339101)
-- Name: TimelineTemplatePhase; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges."TimelineTemplatePhase" (
    id text NOT NULL,
    "timelineTemplateId" text NOT NULL,
    "phaseId" text NOT NULL,
    predecessor text,
    "defaultDuration" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "updatedBy" text NOT NULL
);


ALTER TABLE challenges."TimelineTemplatePhase" OWNER TO challenges;

--
-- TOC entry 396 (class 1259 OID 7338837)
-- Name: _prisma_migrations; Type: TABLE; Schema: challenges; Owner: challenges
--

CREATE TABLE challenges._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE challenges._prisma_migrations OWNER TO challenges;

--
-- TOC entry 5474 (class 2606 OID 7338962)
-- Name: Attachment Attachment_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Attachment"
    ADD CONSTRAINT "Attachment_pkey" PRIMARY KEY (id);


--
-- TOC entry 5472 (class 2606 OID 7338954)
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- TOC entry 5490 (class 2606 OID 7339010)
-- Name: ChallengeBilling ChallengeBilling_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeBilling"
    ADD CONSTRAINT "ChallengeBilling_pkey" PRIMARY KEY (id);


--
-- TOC entry 5504 (class 2606 OID 7339058)
-- Name: ChallengeConstraint ChallengeConstraint_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeConstraint"
    ADD CONSTRAINT "ChallengeConstraint_pkey" PRIMARY KEY (id);


--
-- TOC entry 5501 (class 2606 OID 7339049)
-- Name: ChallengeDiscussionOption ChallengeDiscussionOption_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeDiscussionOption"
    ADD CONSTRAINT "ChallengeDiscussionOption_pkey" PRIMARY KEY (id);


--
-- TOC entry 5499 (class 2606 OID 7339041)
-- Name: ChallengeDiscussion ChallengeDiscussion_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeDiscussion"
    ADD CONSTRAINT "ChallengeDiscussion_pkey" PRIMARY KEY (id);


--
-- TOC entry 5496 (class 2606 OID 7339033)
-- Name: ChallengeEvent ChallengeEvent_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeEvent"
    ADD CONSTRAINT "ChallengeEvent_pkey" PRIMARY KEY (id);


--
-- TOC entry 5493 (class 2606 OID 7339025)
-- Name: ChallengeLegacy ChallengeLegacy_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeLegacy"
    ADD CONSTRAINT "ChallengeLegacy_pkey" PRIMARY KEY (id);


--
-- TOC entry 5477 (class 2606 OID 7338970)
-- Name: ChallengeMetadata ChallengeMetadata_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeMetadata"
    ADD CONSTRAINT "ChallengeMetadata_pkey" PRIMARY KEY (id);


--
-- TOC entry 5516 (class 2606 OID 7339083)
-- Name: ChallengePhaseConstraint ChallengePhaseConstraint_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePhaseConstraint"
    ADD CONSTRAINT "ChallengePhaseConstraint_pkey" PRIMARY KEY (id);


--
-- TOC entry 5512 (class 2606 OID 7339075)
-- Name: ChallengePhase ChallengePhase_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePhase"
    ADD CONSTRAINT "ChallengePhase_pkey" PRIMARY KEY (id);


--
-- TOC entry 5520 (class 2606 OID 7339091)
-- Name: ChallengePrizeSet ChallengePrizeSet_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePrizeSet"
    ADD CONSTRAINT "ChallengePrizeSet_pkey" PRIMARY KEY (id);


--
-- TOC entry 5532 (class 2606 OID 9374672)
-- Name: ChallengeReviewer ChallengeReviewer_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeReviewer"
    ADD CONSTRAINT "ChallengeReviewer_pkey" PRIMARY KEY (id);


--
-- TOC entry 5487 (class 2606 OID 7339002)
-- Name: ChallengeSkill ChallengeSkill_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeSkill"
    ADD CONSTRAINT "ChallengeSkill_pkey" PRIMARY KEY (id);


--
-- TOC entry 5485 (class 2606 OID 7338994)
-- Name: ChallengeTerm ChallengeTerm_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTerm"
    ADD CONSTRAINT "ChallengeTerm_pkey" PRIMARY KEY (id);


--
-- TOC entry 5468 (class 2606 OID 7338946)
-- Name: ChallengeTimelineTemplate ChallengeTimelineTemplate_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTimelineTemplate"
    ADD CONSTRAINT "ChallengeTimelineTemplate_pkey" PRIMARY KEY (id);


--
-- TOC entry 5466 (class 2606 OID 7338937)
-- Name: ChallengeTrack ChallengeTrack_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTrack"
    ADD CONSTRAINT "ChallengeTrack_pkey" PRIMARY KEY (id);


--
-- TOC entry 5463 (class 2606 OID 7338929)
-- Name: ChallengeType ChallengeType_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeType"
    ADD CONSTRAINT "ChallengeType_pkey" PRIMARY KEY (id);


--
-- TOC entry 5483 (class 2606 OID 7338986)
-- Name: ChallengeWinner ChallengeWinner_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeWinner"
    ADD CONSTRAINT "ChallengeWinner_pkey" PRIMARY KEY (id);


--
-- TOC entry 5445 (class 2606 OID 7338919)
-- Name: Challenge Challenge_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Challenge"
    ADD CONSTRAINT "Challenge_pkey" PRIMARY KEY (id);


--
-- TOC entry 5535 (class 2606 OID 9456542)
-- Name: DefaultChallengeReviewer DefaultChallengeReviewer_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."DefaultChallengeReviewer"
    ADD CONSTRAINT "DefaultChallengeReviewer_pkey" PRIMARY KEY (id);


--
-- TOC entry 5507 (class 2606 OID 7339066)
-- Name: Phase Phase_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Phase"
    ADD CONSTRAINT "Phase_pkey" PRIMARY KEY (id);


--
-- TOC entry 5479 (class 2606 OID 7338978)
-- Name: Prize Prize_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Prize"
    ADD CONSTRAINT "Prize_pkey" PRIMARY KEY (id);


--
-- TOC entry 5525 (class 2606 OID 7339108)
-- Name: TimelineTemplatePhase TimelineTemplatePhase_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."TimelineTemplatePhase"
    ADD CONSTRAINT "TimelineTemplatePhase_pkey" PRIMARY KEY (id);


--
-- TOC entry 5523 (class 2606 OID 7339100)
-- Name: TimelineTemplate TimelineTemplate_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."TimelineTemplate"
    ADD CONSTRAINT "TimelineTemplate_pkey" PRIMARY KEY (id);


--
-- TOC entry 5440 (class 2606 OID 7338845)
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- TOC entry 5470 (class 1259 OID 7339114)
-- Name: AuditLog_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "AuditLog_challengeId_idx" ON challenges."AuditLog" USING btree ("challengeId");


--
-- TOC entry 5488 (class 1259 OID 7339117)
-- Name: ChallengeBilling_challengeId_key; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE UNIQUE INDEX "ChallengeBilling_challengeId_key" ON challenges."ChallengeBilling" USING btree ("challengeId");


--
-- TOC entry 5502 (class 1259 OID 7339121)
-- Name: ChallengeConstraint_challengeId_key; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE UNIQUE INDEX "ChallengeConstraint_challengeId_key" ON challenges."ChallengeConstraint" USING btree ("challengeId");


--
-- TOC entry 5497 (class 1259 OID 7339120)
-- Name: ChallengeDiscussion_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeDiscussion_challengeId_idx" ON challenges."ChallengeDiscussion" USING btree ("challengeId");


--
-- TOC entry 5494 (class 1259 OID 7339119)
-- Name: ChallengeEvent_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeEvent_challengeId_idx" ON challenges."ChallengeEvent" USING btree ("challengeId");


--
-- TOC entry 5491 (class 1259 OID 7339118)
-- Name: ChallengeLegacy_challengeId_key; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE UNIQUE INDEX "ChallengeLegacy_challengeId_key" ON challenges."ChallengeLegacy" USING btree ("challengeId");


--
-- TOC entry 5475 (class 1259 OID 7339115)
-- Name: ChallengeMetadata_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeMetadata_challengeId_idx" ON challenges."ChallengeMetadata" USING btree ("challengeId");


--
-- TOC entry 5514 (class 1259 OID 7339124)
-- Name: ChallengePhaseConstraint_challengePhaseId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePhaseConstraint_challengePhaseId_idx" ON challenges."ChallengePhaseConstraint" USING btree ("challengePhaseId");


--
-- TOC entry 5508 (class 1259 OID 7339123)
-- Name: ChallengePhase_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePhase_challengeId_idx" ON challenges."ChallengePhase" USING btree ("challengeId");


--
-- TOC entry 5509 (class 1259 OID 10715830)
-- Name: ChallengePhase_challengeId_isOpen_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePhase_challengeId_isOpen_idx" ON challenges."ChallengePhase" USING btree ("challengeId", "isOpen");


--
-- TOC entry 5510 (class 1259 OID 10715831)
-- Name: ChallengePhase_challengeId_name_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePhase_challengeId_name_idx" ON challenges."ChallengePhase" USING btree ("challengeId", name);


--
-- TOC entry 5517 (class 1259 OID 7339125)
-- Name: ChallengePrizeSet_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePrizeSet_challengeId_idx" ON challenges."ChallengePrizeSet" USING btree ("challengeId");


--
-- TOC entry 5518 (class 1259 OID 10715832)
-- Name: ChallengePrizeSet_challengeId_type_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengePrizeSet_challengeId_type_idx" ON challenges."ChallengePrizeSet" USING btree ("challengeId", type);


--
-- TOC entry 5528 (class 1259 OID 9374673)
-- Name: ChallengeReviewer_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeReviewer_challengeId_idx" ON challenges."ChallengeReviewer" USING btree ("challengeId");


--
-- TOC entry 5529 (class 1259 OID 10715833)
-- Name: ChallengeReviewer_challengeId_phaseId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeReviewer_challengeId_phaseId_idx" ON challenges."ChallengeReviewer" USING btree ("challengeId", "phaseId");


--
-- TOC entry 5530 (class 1259 OID 9374674)
-- Name: ChallengeReviewer_phaseId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeReviewer_phaseId_idx" ON challenges."ChallengeReviewer" USING btree ("phaseId");


--
-- TOC entry 5469 (class 1259 OID 7339113)
-- Name: ChallengeTimelineTemplate_typeId_trackId_timelineTemplateId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeTimelineTemplate_typeId_trackId_timelineTemplateId_idx" ON challenges."ChallengeTimelineTemplate" USING btree ("typeId", "trackId", "timelineTemplateId");


--
-- TOC entry 5464 (class 1259 OID 7339112)
-- Name: ChallengeTrack_legacyId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeTrack_legacyId_idx" ON challenges."ChallengeTrack" USING btree ("legacyId");


--
-- TOC entry 5461 (class 1259 OID 7339111)
-- Name: ChallengeType_abbreviation_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeType_abbreviation_idx" ON challenges."ChallengeType" USING btree (abbreviation);


--
-- TOC entry 5480 (class 1259 OID 7339116)
-- Name: ChallengeWinner_challengeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeWinner_challengeId_idx" ON challenges."ChallengeWinner" USING btree ("challengeId");


--
-- TOC entry 5481 (class 1259 OID 10715834)
-- Name: ChallengeWinner_challengeId_type_placement_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "ChallengeWinner_challengeId_type_placement_idx" ON challenges."ChallengeWinner" USING btree ("challengeId", type, placement);


--
-- TOC entry 5441 (class 1259 OID 9374675)
-- Name: Challenge_createdAt_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_createdAt_idx" ON challenges."Challenge" USING btree ("createdAt");


--
-- TOC entry 5442 (class 1259 OID 9374684)
-- Name: Challenge_endDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_endDate_idx" ON challenges."Challenge" USING btree ("endDate");


--
-- TOC entry 5443 (class 1259 OID 10715828)
-- Name: Challenge_legacyId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_legacyId_idx" ON challenges."Challenge" USING btree ("legacyId");


--
-- TOC entry 5446 (class 1259 OID 7339109)
-- Name: Challenge_projectId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_projectId_idx" ON challenges."Challenge" USING btree ("projectId");


--
-- TOC entry 5447 (class 1259 OID 10715829)
-- Name: Challenge_projectId_status_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_projectId_status_idx" ON challenges."Challenge" USING btree ("projectId", status);


--
-- TOC entry 5448 (class 1259 OID 9374682)
-- Name: Challenge_registrationEndDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_registrationEndDate_idx" ON challenges."Challenge" USING btree ("registrationEndDate");


--
-- TOC entry 5449 (class 1259 OID 9374681)
-- Name: Challenge_registrationStartDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_registrationStartDate_idx" ON challenges."Challenge" USING btree ("registrationStartDate");


--
-- TOC entry 5450 (class 1259 OID 9374683)
-- Name: Challenge_startDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_startDate_idx" ON challenges."Challenge" USING btree ("startDate");


--
-- TOC entry 5451 (class 1259 OID 7339110)
-- Name: Challenge_status_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_status_idx" ON challenges."Challenge" USING btree (status);


--
-- TOC entry 5452 (class 1259 OID 10715826)
-- Name: Challenge_status_startDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_status_startDate_idx" ON challenges."Challenge" USING btree (status, "startDate");


--
-- TOC entry 5453 (class 1259 OID 9374680)
-- Name: Challenge_submissionEndDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_submissionEndDate_idx" ON challenges."Challenge" USING btree ("submissionEndDate");


--
-- TOC entry 5454 (class 1259 OID 9374679)
-- Name: Challenge_submissionStartDate_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_submissionStartDate_idx" ON challenges."Challenge" USING btree ("submissionStartDate");


--
-- TOC entry 5455 (class 1259 OID 9374678)
-- Name: Challenge_trackId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_trackId_idx" ON challenges."Challenge" USING btree ("trackId");


--
-- TOC entry 5456 (class 1259 OID 10715827)
-- Name: Challenge_trackId_typeId_status_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_trackId_typeId_status_idx" ON challenges."Challenge" USING btree ("trackId", "typeId", status);


--
-- TOC entry 5457 (class 1259 OID 9374677)
-- Name: Challenge_typeId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_typeId_idx" ON challenges."Challenge" USING btree ("typeId");


--
-- TOC entry 5458 (class 1259 OID 9374676)
-- Name: Challenge_updatedAt_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "Challenge_updatedAt_idx" ON challenges."Challenge" USING btree ("updatedAt");


--
-- TOC entry 5533 (class 1259 OID 10365584)
-- Name: DefaultChallengeReviewer_phaseId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "DefaultChallengeReviewer_phaseId_idx" ON challenges."DefaultChallengeReviewer" USING btree ("phaseId");


--
-- TOC entry 5536 (class 1259 OID 9456543)
-- Name: DefaultChallengeReviewer_typeId_trackId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "DefaultChallengeReviewer_typeId_trackId_idx" ON challenges."DefaultChallengeReviewer" USING btree ("typeId", "trackId");


--
-- TOC entry 5537 (class 1259 OID 10415611)
-- Name: DefaultChallengeReviewer_typeId_trackId_timelineTemplateId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "DefaultChallengeReviewer_typeId_trackId_timelineTemplateId_idx" ON challenges."DefaultChallengeReviewer" USING btree ("typeId", "trackId", "timelineTemplateId");


--
-- TOC entry 5505 (class 1259 OID 7339122)
-- Name: Phase_name_key; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE UNIQUE INDEX "Phase_name_key" ON challenges."Phase" USING btree (name);


--
-- TOC entry 5526 (class 1259 OID 7339127)
-- Name: TimelineTemplatePhase_timelineTemplateId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "TimelineTemplatePhase_timelineTemplateId_idx" ON challenges."TimelineTemplatePhase" USING btree ("timelineTemplateId");


--
-- TOC entry 5527 (class 1259 OID 10715835)
-- Name: TimelineTemplatePhase_timelineTemplateId_phaseId_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX "TimelineTemplatePhase_timelineTemplateId_phaseId_idx" ON challenges."TimelineTemplatePhase" USING btree ("timelineTemplateId", "phaseId");


--
-- TOC entry 5521 (class 1259 OID 7339126)
-- Name: TimelineTemplate_name_key; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE UNIQUE INDEX "TimelineTemplate_name_key" ON challenges."TimelineTemplate" USING btree (name);


--
-- TOC entry 5459 (class 1259 OID 11171870)
-- Name: challenge_name_trgm_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX challenge_name_trgm_idx ON challenges."Challenge" USING gin (name gin_trgm_ops);


--
-- TOC entry 5513 (class 1259 OID 10908625)
-- Name: challenge_phase_challenge_open_end_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX challenge_phase_challenge_open_end_idx ON challenges."ChallengePhase" USING btree ("challengeId", "isOpen", "scheduledEndDate", "actualEndDate");


--
-- TOC entry 5460 (class 1259 OID 10908624)
-- Name: challenge_status_type_track_created_at_idx; Type: INDEX; Schema: challenges; Owner: challenges
--

CREATE INDEX challenge_status_type_track_created_at_idx ON challenges."Challenge" USING btree (status, "typeId", "trackId", "createdAt" DESC);


--
-- TOC entry 5545 (class 2606 OID 7339163)
-- Name: Attachment Attachment_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Attachment"
    ADD CONSTRAINT "Attachment_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5544 (class 2606 OID 7339158)
-- Name: AuditLog AuditLog_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."AuditLog"
    ADD CONSTRAINT "AuditLog_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 5551 (class 2606 OID 7339193)
-- Name: ChallengeBilling ChallengeBilling_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeBilling"
    ADD CONSTRAINT "ChallengeBilling_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5556 (class 2606 OID 7339218)
-- Name: ChallengeConstraint ChallengeConstraint_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeConstraint"
    ADD CONSTRAINT "ChallengeConstraint_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5555 (class 2606 OID 7339213)
-- Name: ChallengeDiscussionOption ChallengeDiscussionOption_discussionId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeDiscussionOption"
    ADD CONSTRAINT "ChallengeDiscussionOption_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES challenges."ChallengeDiscussion"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5554 (class 2606 OID 7339208)
-- Name: ChallengeDiscussion ChallengeDiscussion_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeDiscussion"
    ADD CONSTRAINT "ChallengeDiscussion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5553 (class 2606 OID 7339203)
-- Name: ChallengeEvent ChallengeEvent_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeEvent"
    ADD CONSTRAINT "ChallengeEvent_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5552 (class 2606 OID 7339198)
-- Name: ChallengeLegacy ChallengeLegacy_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeLegacy"
    ADD CONSTRAINT "ChallengeLegacy_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5546 (class 2606 OID 7339168)
-- Name: ChallengeMetadata ChallengeMetadata_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeMetadata"
    ADD CONSTRAINT "ChallengeMetadata_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5559 (class 2606 OID 7339233)
-- Name: ChallengePhaseConstraint ChallengePhaseConstraint_challengePhaseId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePhaseConstraint"
    ADD CONSTRAINT "ChallengePhaseConstraint_challengePhaseId_fkey" FOREIGN KEY ("challengePhaseId") REFERENCES challenges."ChallengePhase"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5557 (class 2606 OID 7339223)
-- Name: ChallengePhase ChallengePhase_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePhase"
    ADD CONSTRAINT "ChallengePhase_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5558 (class 2606 OID 7339228)
-- Name: ChallengePhase ChallengePhase_phaseId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePhase"
    ADD CONSTRAINT "ChallengePhase_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES challenges."Phase"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5560 (class 2606 OID 7339238)
-- Name: ChallengePrizeSet ChallengePrizeSet_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengePrizeSet"
    ADD CONSTRAINT "ChallengePrizeSet_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5562 (class 2606 OID 9374685)
-- Name: ChallengeReviewer ChallengeReviewer_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeReviewer"
    ADD CONSTRAINT "ChallengeReviewer_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5563 (class 2606 OID 9374690)
-- Name: ChallengeReviewer ChallengeReviewer_phaseId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeReviewer"
    ADD CONSTRAINT "ChallengeReviewer_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES challenges."Phase"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5550 (class 2606 OID 7339188)
-- Name: ChallengeSkill ChallengeSkill_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeSkill"
    ADD CONSTRAINT "ChallengeSkill_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5549 (class 2606 OID 7339183)
-- Name: ChallengeTerm ChallengeTerm_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTerm"
    ADD CONSTRAINT "ChallengeTerm_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5541 (class 2606 OID 7339143)
-- Name: ChallengeTimelineTemplate ChallengeTimelineTemplate_timelineTemplateId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTimelineTemplate"
    ADD CONSTRAINT "ChallengeTimelineTemplate_timelineTemplateId_fkey" FOREIGN KEY ("timelineTemplateId") REFERENCES challenges."TimelineTemplate"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5542 (class 2606 OID 7339148)
-- Name: ChallengeTimelineTemplate ChallengeTimelineTemplate_trackId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTimelineTemplate"
    ADD CONSTRAINT "ChallengeTimelineTemplate_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES challenges."ChallengeTrack"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5543 (class 2606 OID 7339153)
-- Name: ChallengeTimelineTemplate ChallengeTimelineTemplate_typeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeTimelineTemplate"
    ADD CONSTRAINT "ChallengeTimelineTemplate_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES challenges."ChallengeType"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5548 (class 2606 OID 7339178)
-- Name: ChallengeWinner ChallengeWinner_challengeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."ChallengeWinner"
    ADD CONSTRAINT "ChallengeWinner_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES challenges."Challenge"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5538 (class 2606 OID 7339138)
-- Name: Challenge Challenge_timelineTemplateId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Challenge"
    ADD CONSTRAINT "Challenge_timelineTemplateId_fkey" FOREIGN KEY ("timelineTemplateId") REFERENCES challenges."TimelineTemplate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 5539 (class 2606 OID 7339133)
-- Name: Challenge Challenge_trackId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Challenge"
    ADD CONSTRAINT "Challenge_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES challenges."ChallengeTrack"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5540 (class 2606 OID 7339128)
-- Name: Challenge Challenge_typeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Challenge"
    ADD CONSTRAINT "Challenge_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES challenges."ChallengeType"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5564 (class 2606 OID 10366627)
-- Name: DefaultChallengeReviewer DefaultChallengeReviewer_phaseId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."DefaultChallengeReviewer"
    ADD CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES challenges."Phase"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 5565 (class 2606 OID 10415612)
-- Name: DefaultChallengeReviewer DefaultChallengeReviewer_timelineTemplateId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."DefaultChallengeReviewer"
    ADD CONSTRAINT "DefaultChallengeReviewer_timelineTemplateId_fkey" FOREIGN KEY ("timelineTemplateId") REFERENCES challenges."TimelineTemplate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 5566 (class 2606 OID 9456549)
-- Name: DefaultChallengeReviewer DefaultChallengeReviewer_trackId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."DefaultChallengeReviewer"
    ADD CONSTRAINT "DefaultChallengeReviewer_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES challenges."ChallengeTrack"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5567 (class 2606 OID 9456544)
-- Name: DefaultChallengeReviewer DefaultChallengeReviewer_typeId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."DefaultChallengeReviewer"
    ADD CONSTRAINT "DefaultChallengeReviewer_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES challenges."ChallengeType"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- TOC entry 5547 (class 2606 OID 7339173)
-- Name: Prize Prize_prizeSetId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."Prize"
    ADD CONSTRAINT "Prize_prizeSetId_fkey" FOREIGN KEY ("prizeSetId") REFERENCES challenges."ChallengePrizeSet"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5561 (class 2606 OID 7339243)
-- Name: TimelineTemplatePhase TimelineTemplatePhase_timelineTemplateId_fkey; Type: FK CONSTRAINT; Schema: challenges; Owner: challenges
--

ALTER TABLE ONLY challenges."TimelineTemplatePhase"
    ADD CONSTRAINT "TimelineTemplatePhase_timelineTemplateId_fkey" FOREIGN KEY ("timelineTemplateId") REFERENCES challenges."TimelineTemplate"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5747 (class 0 OID 0)
-- Dependencies: 17
-- Name: SCHEMA challenges; Type: ACL; Schema: -; Owner: topcoder
--

GRANT ALL ON SCHEMA challenges TO challenges;
GRANT USAGE ON SCHEMA challenges TO skills;


--
-- TOC entry 5748 (class 0 OID 0)
-- Dependencies: 402
-- Name: TABLE "Attachment"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."Attachment" TO skills;


--
-- TOC entry 5749 (class 0 OID 0)
-- Dependencies: 401
-- Name: TABLE "AuditLog"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."AuditLog" TO skills;


--
-- TOC entry 5750 (class 0 OID 0)
-- Dependencies: 397
-- Name: TABLE "Challenge"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."Challenge" TO skills;


--
-- TOC entry 5751 (class 0 OID 0)
-- Dependencies: 408
-- Name: TABLE "ChallengeBilling"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeBilling" TO skills;


--
-- TOC entry 5752 (class 0 OID 0)
-- Dependencies: 413
-- Name: TABLE "ChallengeConstraint"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeConstraint" TO skills;


--
-- TOC entry 5753 (class 0 OID 0)
-- Dependencies: 411
-- Name: TABLE "ChallengeDiscussion"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeDiscussion" TO skills;


--
-- TOC entry 5754 (class 0 OID 0)
-- Dependencies: 412
-- Name: TABLE "ChallengeDiscussionOption"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeDiscussionOption" TO skills;


--
-- TOC entry 5755 (class 0 OID 0)
-- Dependencies: 410
-- Name: TABLE "ChallengeEvent"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeEvent" TO skills;


--
-- TOC entry 5756 (class 0 OID 0)
-- Dependencies: 409
-- Name: TABLE "ChallengeLegacy"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeLegacy" TO skills;


--
-- TOC entry 5757 (class 0 OID 0)
-- Dependencies: 403
-- Name: TABLE "ChallengeMetadata"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeMetadata" TO skills;


--
-- TOC entry 5758 (class 0 OID 0)
-- Dependencies: 415
-- Name: TABLE "ChallengePhase"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengePhase" TO skills;


--
-- TOC entry 5759 (class 0 OID 0)
-- Dependencies: 416
-- Name: TABLE "ChallengePhaseConstraint"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengePhaseConstraint" TO skills;


--
-- TOC entry 5760 (class 0 OID 0)
-- Dependencies: 417
-- Name: TABLE "ChallengePrizeSet"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengePrizeSet" TO skills;


--
-- TOC entry 5761 (class 0 OID 0)
-- Dependencies: 596
-- Name: TABLE "ChallengeReviewer"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeReviewer" TO skills;


--
-- TOC entry 5762 (class 0 OID 0)
-- Dependencies: 407
-- Name: TABLE "ChallengeSkill"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeSkill" TO skills;


--
-- TOC entry 5763 (class 0 OID 0)
-- Dependencies: 406
-- Name: TABLE "ChallengeTerm"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeTerm" TO skills;


--
-- TOC entry 5764 (class 0 OID 0)
-- Dependencies: 400
-- Name: TABLE "ChallengeTimelineTemplate"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeTimelineTemplate" TO skills;


--
-- TOC entry 5765 (class 0 OID 0)
-- Dependencies: 399
-- Name: TABLE "ChallengeTrack"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeTrack" TO skills;


--
-- TOC entry 5766 (class 0 OID 0)
-- Dependencies: 398
-- Name: TABLE "ChallengeType"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeType" TO skills;


--
-- TOC entry 5767 (class 0 OID 0)
-- Dependencies: 405
-- Name: TABLE "ChallengeWinner"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."ChallengeWinner" TO skills;


--
-- TOC entry 5768 (class 0 OID 0)
-- Dependencies: 601
-- Name: TABLE "DefaultChallengeReviewer"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."DefaultChallengeReviewer" TO skills;


--
-- TOC entry 5769 (class 0 OID 0)
-- Dependencies: 414
-- Name: TABLE "Phase"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."Phase" TO skills;


--
-- TOC entry 5770 (class 0 OID 0)
-- Dependencies: 404
-- Name: TABLE "Prize"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."Prize" TO skills;


--
-- TOC entry 5771 (class 0 OID 0)
-- Dependencies: 418
-- Name: TABLE "TimelineTemplate"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."TimelineTemplate" TO skills;


--
-- TOC entry 5772 (class 0 OID 0)
-- Dependencies: 419
-- Name: TABLE "TimelineTemplatePhase"; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges."TimelineTemplatePhase" TO skills;


--
-- TOC entry 5773 (class 0 OID 0)
-- Dependencies: 396
-- Name: TABLE _prisma_migrations; Type: ACL; Schema: challenges; Owner: challenges
--

GRANT SELECT ON TABLE challenges._prisma_migrations TO skills;


-- Completed on 2025-11-12 07:58:01 AEDT

--
-- PostgreSQL database dump complete
--

\unrestrict ybCAF7hqlau3z1Rkf7WLMILtRGkO00JHWyoZdUXMHCvn3yICl4WXr7TAHScGcI8

