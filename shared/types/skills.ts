// Per-user Skills types — server and client must agree on this surface
// verbatim. The stored zip archive is never serialized to the client; only the
// metadata below is sent.

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillListResponse {
  skills: SkillDTO[];
}

/** Per-skill error from an upload — `name` is present once a skill's canonical
 *  name is known, otherwise the error is scope-level (e.g. a bad zip). */
export interface SkillUploadError {
  name?: string;
  message: string;
}

/** Result of `POST /api/me/skills/upload`. Independent skills succeed even when
 *  others error, so all three lists can be non-empty in one response. */
export interface SkillUploadResponse {
  created: string[];
  updated: string[];
  errors: SkillUploadError[];
}

export interface SkillSetEnabledRequest {
  enabled: boolean;
}
