--
-- PostgreSQL database dump
--

\restrict F3OWvVqHTambAJye2zwdnezHuRacLFOkUrlL6eeCig3nl8GUYQwlkLHsoNPLSI6

-- Dumped from database version 17.8 (6108b59)
-- Dumped by pg_dump version 17.8 (Ubuntu 17.8-1.pgdg24.04+1)

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
-- Name: neon_auth; Type: SCHEMA; Schema: -; Owner: neon_auth
--

CREATE SCHEMA neon_auth;


ALTER SCHEMA neon_auth OWNER TO neon_auth;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" uuid NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE neon_auth.account OWNER TO neon_auth;

--
-- Name: invitation; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "organizationId" uuid NOT NULL,
    email text NOT NULL,
    role text,
    status text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" uuid NOT NULL
);


ALTER TABLE neon_auth.invitation OWNER TO neon_auth;

--
-- Name: jwks; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.jwks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone
);


ALTER TABLE neon_auth.jwks OWNER TO neon_auth;

--
-- Name: member; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "organizationId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);


ALTER TABLE neon_auth.member OWNER TO neon_auth;

--
-- Name: organization; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamp with time zone NOT NULL,
    metadata text
);


ALTER TABLE neon_auth.organization OWNER TO neon_auth;

--
-- Name: project_config; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.project_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    endpoint_id text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    trusted_origins jsonb NOT NULL,
    social_providers jsonb NOT NULL,
    email_provider jsonb,
    email_and_password jsonb,
    allow_localhost boolean NOT NULL
);


ALTER TABLE neon_auth.project_config OWNER TO neon_auth;

--
-- Name: session; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" uuid NOT NULL,
    "impersonatedBy" text,
    "activeOrganizationId" text
);


ALTER TABLE neon_auth.session OWNER TO neon_auth;

--
-- Name: user; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth."user" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role text,
    banned boolean,
    "banReason" text,
    "banExpires" timestamp with time zone
);


ALTER TABLE neon_auth."user" OWNER TO neon_auth;

--
-- Name: verification; Type: TABLE; Schema: neon_auth; Owner: neon_auth
--

CREATE TABLE neon_auth.verification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE neon_auth.verification OWNER TO neon_auth;

--
-- Name: ClanAsset; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."ClanAsset" (
    "guildId" text NOT NULL,
    "roleId" text NOT NULL,
    "messageLink" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ClanAsset" OWNER TO neondb_owner;

--
-- Name: GifCache; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."GifCache" (
    "rankHash" text NOT NULL,
    "messageLink" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."GifCache" OWNER TO neondb_owner;

--
-- Name: GifTemplate; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."GifTemplate" (
    id integer NOT NULL,
    name text NOT NULL,
    "clanCount" integer NOT NULL,
    "folderPath" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."GifTemplate" OWNER TO neondb_owner;

--
-- Name: GifTemplate_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."GifTemplate_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."GifTemplate_id_seq" OWNER TO neondb_owner;

--
-- Name: GifTemplate_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."GifTemplate_id_seq" OWNED BY public."GifTemplate".id;


--
-- Name: GuildConfig; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."GuildConfig" (
    "guildId" text NOT NULL,
    "reactionRoles" jsonb DEFAULT '{}'::jsonb,
    "roleRequests" jsonb DEFAULT '[]'::jsonb,
    keywords jsonb DEFAULT '{}'::jsonb,
    config jsonb DEFAULT '{}'::jsonb,
    ids jsonb DEFAULT '{}'::jsonb,
    "resetRoleData" jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    clans jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public."GuildConfig" OWNER TO neondb_owner;

--
-- Name: JailLog; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."JailLog" (
    id integer NOT NULL,
    "guildId" text NOT NULL,
    "userId" text NOT NULL,
    username text NOT NULL,
    offences integer DEFAULT 0 NOT NULL,
    "punishmentEnd" timestamp(3) without time zone,
    status text DEFAULT 'jailed'::text NOT NULL,
    "messageId" text,
    votes text[] DEFAULT ARRAY[]::text[],
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "caseId" text
);


ALTER TABLE public."JailLog" OWNER TO neondb_owner;

--
-- Name: JailLog_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."JailLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."JailLog_id_seq" OWNER TO neondb_owner;

--
-- Name: JailLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."JailLog_id_seq" OWNED BY public."JailLog".id;


--
-- Name: LeaderboardState; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."LeaderboardState" (
    "guildId" text NOT NULL,
    "lastMessageId" text,
    "lastRanks" jsonb,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."LeaderboardState" OWNER TO neondb_owner;

--
-- Name: ResetCycle; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."ResetCycle" (
    "guildId" text NOT NULL,
    "cycleCount" integer DEFAULT 0 NOT NULL,
    "lastResetUtc" timestamp(3) without time zone NOT NULL,
    "resetHour" integer DEFAULT 0 NOT NULL,
    "resetMinute" integer DEFAULT 0 NOT NULL
);


ALTER TABLE public."ResetCycle" OWNER TO neondb_owner;

--
-- Name: UserXp; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."UserXp" (
    "userId" text NOT NULL,
    "guildId" text NOT NULL,
    xp integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "dailyXp" integer DEFAULT 0 NOT NULL,
    "weeklyXp" integer DEFAULT 0 NOT NULL,
    "clanId" integer DEFAULT 0
);


ALTER TABLE public."UserXp" OWNER TO neondb_owner;

--
-- Name: GifTemplate id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."GifTemplate" ALTER COLUMN id SET DEFAULT nextval('public."GifTemplate_id_seq"'::regclass);


--
-- Name: JailLog id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."JailLog" ALTER COLUMN id SET DEFAULT nextval('public."JailLog_id_seq"'::regclass);


--
-- Data for Name: account; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, password, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: invitation; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.invitation (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId") FROM stdin;
\.


--
-- Data for Name: jwks; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.jwks (id, "publicKey", "privateKey", "createdAt", "expiresAt") FROM stdin;
\.


--
-- Data for Name: member; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.member (id, "organizationId", "userId", role, "createdAt") FROM stdin;
\.


--
-- Data for Name: organization; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.organization (id, name, slug, logo, "createdAt", metadata) FROM stdin;
\.


--
-- Data for Name: project_config; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.project_config (id, name, endpoint_id, created_at, updated_at, trusted_origins, social_providers, email_provider, email_and_password, allow_localhost) FROM stdin;
9db88ed9-9666-44a8-8191-5a29ce90f009	Ryan	ep-young-grass-agn6yxvx	2025-12-27 17:21:28.604+00	2025-12-27 17:21:28.604+00	[]	[{"id": "google", "isShared": true}]	{"type": "shared"}	{"enabled": true, "disableSignUp": false, "emailVerificationMethod": "otp", "requireEmailVerification": false, "autoSignInAfterVerification": true, "sendVerificationEmailOnSignIn": false, "sendVerificationEmailOnSignUp": false}	t
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId", "impersonatedBy", "activeOrganizationId") FROM stdin;
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned, "banReason", "banExpires") FROM stdin;
\.


--
-- Data for Name: verification; Type: TABLE DATA; Schema: neon_auth; Owner: neon_auth
--

COPY neon_auth.verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ClanAsset; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."ClanAsset" ("guildId", "roleId", "messageLink", "updatedAt") FROM stdin;
1227505156220784692	1247225208700665856	https://discord.com/channels/1227505156220784692/1301183910838796460/1462857882113671252	2026-01-19 17:14:58.01
1227505156220784692	1245407423917854754	https://discord.com/channels/1227505156220784692/1301183910838796460/1462858705401020540	2026-01-19 17:18:14.265
\.


--
-- Data for Name: GifCache; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."GifCache" ("rankHash", "messageLink", "createdAt") FROM stdin;
count:2|1:1247225208700665856|2:1245407423917854754	https://discord.com/channels/1227505156220784692/1301183910838796460/1462895247796473978	2026-01-19 19:43:26.843
count:2|1:1245407423917854754|2:1247225208700665856	https://discord.com/channels/1227505156220784692/1301183910838796460/1462899412295745660	2026-01-19 19:02:35.935
\.


--
-- Data for Name: GifTemplate; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."GifTemplate" (id, name, "clanCount", "folderPath", "createdAt") FROM stdin;
1	2 clans template	2	/home/container/assets/gif_templates/2/2 clans template	2026-01-19 09:29:40.709
2	3 clans template	3	/home/container/assets/gif_templates/3/3 clans template	2026-01-19 20:33:42.034
3	4 clans template	4	/home/container/assets/gif_templates/4/4 clans template	2026-01-19 20:34:29.234
\.


--
-- Data for Name: GuildConfig; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."GuildConfig" ("guildId", "reactionRoles", "roleRequests", keywords, config, ids, "resetRoleData", "createdAt", "updatedAt", clans) FROM stdin;
1227505156220784692	{"1459960545481592949": {"emoji": "<:NIGGA_GANG:1322968476759097344>", "roleId": "1245407423917854754", "channelId": "1242628949318570065", "messageId": "1459960545481592949", "isClanRole": true, "uniqueRoles": true}, "1459960950626062390": {"emoji": "<:DumbProdigies:1326176475602223184>", "roleId": "1247225208700665856", "channelId": "1242628949318570065", "messageId": "1459960950626062390", "isClanRole": true, "uniqueRoles": true}, "1471950413635911853": {"emoji": "<:hEHeHe:1292615529860825099>", "roleId": "1301578762328080444", "channelId": "1301183910838796460", "messageId": "1471950413635911853", "isClanRole": true, "uniqueRoles": true}, "1471950413640110208": {"emoji": "<:hEHeHe:1292615529860825099>", "roleId": "1301578762328080444", "channelId": "1301183910838796460", "messageId": "1471950413640110208", "isClanRole": true, "uniqueRoles": true}}	[]	{}	{"punishmentCount": 14}	{"modRoleId": "1229339527752056884", "adminRoleId": "1242619459173355621", "clanRole1Id": "1245407423917854754", "clanRole2Id": "1247225208700665856", "adminsOnlyId": "1240872096813285398", "groundRoleId": "1333787263020175454", "modChannelId": "1228738698292625571", "clanChannelId": "1363513448780271806", "jailChannelId": "1333814970563039333", "logsChannelId": "1363513448780271806", "adminChannelId": "1240872096813285398", "clansChannelId": "1242628949318570065", "legendaryRoleId": "1333410844658241637", "roleLogChannelId": "1251143629943345204", "trueLogsChannelId": "1363513448780271806", "leaderboardChannelId": "1318679923187126272", "messageSearchChannelId": "1230014204308881439", "clanLeaderboardMessageId": "1474456331263152141", "dailyLeaderboardMessageId": "1475272878210552043"}	{}	2026-01-09 23:48:44.179	2026-02-22 23:27:45.341	{}
\.


--
-- Data for Name: JailLog; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."JailLog" (id, "guildId", "userId", username, offences, "punishmentEnd", status, "messageId", votes, "updatedAt", "caseId") FROM stdin;
1	1227505156220784692	762715169351532555	black_goku7777	1	2026-01-11 08:28:16.04	released	1459818683365982451	{}	2026-01-11 08:28:16.398	\N
2	1227505156220784692	1303426933580763236	RYAN	1	2026-01-11 17:46:00.124	released	1459959043945926941	{762715169351532555}	2026-01-11 17:46:04.549	\N
3	1227505156220784692	981649513427111957	Would You	1	2026-01-12 12:17:32.146	released	1460238768513744989	{762715169351532555}	2026-01-12 12:17:45.219	\N
4	1227505156220784692	1179857119437131878	zehaan786_47482	1	2026-01-12 12:33:06.875	released	1460242689697255553	{762715169351532555}	2026-01-12 12:33:49.339	\N
5	1227505156220784692	1299724583170998343	leon_s_candy	7	2026-03-15 09:33:55.838	jailed	1472526338715025542	{762715169351532555}	2026-02-15 09:57:28.264	B4
38	1227505156220784692	1459040637381902528	horklongo760	1	\N	released	1472532666938036285	{762715169351532555}	2026-02-15 10:04:29.223	B5
\.


--
-- Data for Name: LeaderboardState; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."LeaderboardState" ("guildId", "lastMessageId", "lastRanks", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ResetCycle; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."ResetCycle" ("guildId", "cycleCount", "lastResetUtc", "resetHour", "resetMinute") FROM stdin;
1227505156220784692	2	2026-02-22 17:22:55.287	0	0
\.


--
-- Data for Name: UserXp; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."UserXp" ("userId", "guildId", xp, "updatedAt", "dailyXp", "weeklyXp", "clanId") FROM stdin;
1260583190691577930	1227505156220784692	2320	2026-02-22 17:23:00.412	0	1	0
1170477664440692799	1227505156220784692	473	2026-02-22 17:23:00.412	0	0	0
1347972043668328549	1227505156220784692	4611	2026-02-22 17:23:00.412	0	0	0
932226426722217995	1227505156220784692	659	2026-02-22 17:23:00.412	0	0	0
1276548964300099635	1227505156220784692	761	2026-02-22 17:23:00.412	0	0	0
1341275034638880828	1227505156220784692	14857	2026-02-22 17:23:00.412	0	0	0
1170643705301045278	1227505156220784692	18	2026-02-22 17:23:00.412	0	0	0
1299724583170998343	1227505156220784692	54	2026-02-22 17:23:00.412	0	0	0
906188788173258814	1227505156220784692	21	2026-02-22 17:23:00.412	0	0	0
728819994992836609	1227505156220784692	7	2026-02-22 17:23:00.412	0	0	0
1252231954888261717	1227505156220784692	5	2026-02-22 17:23:00.412	0	0	0
1240497761279807590	1227505156220784692	25	2026-02-22 17:23:00.412	0	0	0
1321580684770283591	1227505156220784692	75	2026-02-22 17:23:00.412	0	0	0
1469390624707842241	1227505156220784692	40	2026-02-22 17:23:00.412	0	0	0
1303974645451718669	1227505156220784692	17	2026-02-22 17:23:00.412	0	0	0
1436766706503782542	1227505156220784692	71	2026-02-22 17:23:00.412	0	0	0
1093371557931384864	1227505156220784692	1862	2026-02-22 17:23:00.412	0	0	0
1230656408123346964	1227505156220784692	18	2026-02-22 17:23:00.412	0	0	0
749767397497372762	1227505156220784692	709	2026-02-22 17:23:00.412	0	0	0
762715169351532555	1227505156220784692	14904	2026-02-22 17:23:00.412	0	0	0
\.


--
-- Name: GifTemplate_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."GifTemplate_id_seq"', 3, true);


--
-- Name: JailLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."JailLog_id_seq"', 39, true);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);


--
-- Name: member member_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT member_pkey PRIMARY KEY (id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: organization organization_slug_key; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.organization
    ADD CONSTRAINT organization_slug_key UNIQUE (slug);


--
-- Name: project_config project_config_endpoint_id_key; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.project_config
    ADD CONSTRAINT project_config_endpoint_id_key UNIQUE (endpoint_id);


--
-- Name: project_config project_config_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.project_config
    ADD CONSTRAINT project_config_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: ClanAsset ClanAsset_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."ClanAsset"
    ADD CONSTRAINT "ClanAsset_pkey" PRIMARY KEY ("guildId", "roleId");


--
-- Name: GifCache GifCache_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."GifCache"
    ADD CONSTRAINT "GifCache_pkey" PRIMARY KEY ("rankHash");


--
-- Name: GifTemplate GifTemplate_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."GifTemplate"
    ADD CONSTRAINT "GifTemplate_pkey" PRIMARY KEY (id);


--
-- Name: GuildConfig GuildConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."GuildConfig"
    ADD CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId");


--
-- Name: JailLog JailLog_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."JailLog"
    ADD CONSTRAINT "JailLog_pkey" PRIMARY KEY (id);


--
-- Name: LeaderboardState LeaderboardState_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."LeaderboardState"
    ADD CONSTRAINT "LeaderboardState_pkey" PRIMARY KEY ("guildId");


--
-- Name: ResetCycle ResetCycle_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."ResetCycle"
    ADD CONSTRAINT "ResetCycle_pkey" PRIMARY KEY ("guildId");


--
-- Name: UserXp UserXp_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."UserXp"
    ADD CONSTRAINT "UserXp_pkey" PRIMARY KEY ("guildId", "userId");


--
-- Name: account_userId_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX "account_userId_idx" ON neon_auth.account USING btree ("userId");


--
-- Name: invitation_email_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX invitation_email_idx ON neon_auth.invitation USING btree (email);


--
-- Name: invitation_organizationId_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX "invitation_organizationId_idx" ON neon_auth.invitation USING btree ("organizationId");


--
-- Name: member_organizationId_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX "member_organizationId_idx" ON neon_auth.member USING btree ("organizationId");


--
-- Name: member_userId_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX "member_userId_idx" ON neon_auth.member USING btree ("userId");


--
-- Name: organization_slug_uidx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE UNIQUE INDEX organization_slug_uidx ON neon_auth.organization USING btree (slug);


--
-- Name: session_userId_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX "session_userId_idx" ON neon_auth.session USING btree ("userId");


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: neon_auth; Owner: neon_auth
--

CREATE INDEX verification_identifier_idx ON neon_auth.verification USING btree (identifier);


--
-- Name: ClanAsset_roleId_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX "ClanAsset_roleId_key" ON public."ClanAsset" USING btree ("roleId");


--
-- Name: JailLog_guildId_userId_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX "JailLog_guildId_userId_key" ON public."JailLog" USING btree ("guildId", "userId");


--
-- Name: UserXp_guildId_clanId_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "UserXp_guildId_clanId_idx" ON public."UserXp" USING btree ("guildId", "clanId");


--
-- Name: UserXp_guildId_dailyXp_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "UserXp_guildId_dailyXp_idx" ON public."UserXp" USING btree ("guildId", "dailyXp" DESC);


--
-- Name: UserXp_guildId_weeklyXp_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "UserXp_guildId_weeklyXp_idx" ON public."UserXp" USING btree ("guildId", "weeklyXp" DESC);


--
-- Name: UserXp_guildId_xp_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "UserXp_guildId_xp_idx" ON public."UserXp" USING btree ("guildId", xp DESC);


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_inviterId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_organizationId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization(id) ON DELETE CASCADE;


--
-- Name: member member_organizationId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization(id) ON DELETE CASCADE;


--
-- Name: member member_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: neon_auth
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict F3OWvVqHTambAJye2zwdnezHuRacLFOkUrlL6eeCig3nl8GUYQwlkLHsoNPLSI6

