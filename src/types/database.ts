export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          current_consent_version: string
          id: boolean
          recording_max_ms: number
          recording_min_ms: number
          recording_min_speech_ms: number
          recording_rate_limit: number
          recording_rate_window: unknown
          skip_cooldown: unknown
          translation_max_ratio: number
          translation_min_ratio: number
          translation_rate_limit: number
          translation_rate_window: unknown
          updated_at: string
        }
        Insert: {
          current_consent_version: string
          id?: boolean
          recording_max_ms?: number
          recording_min_ms?: number
          recording_min_speech_ms?: number
          recording_rate_limit?: number
          recording_rate_window?: unknown
          skip_cooldown?: unknown
          translation_max_ratio?: number
          translation_min_ratio?: number
          translation_rate_limit?: number
          translation_rate_window?: unknown
          updated_at?: string
        }
        Update: {
          current_consent_version?: string
          id?: boolean
          recording_max_ms?: number
          recording_min_ms?: number
          recording_min_speech_ms?: number
          recording_rate_limit?: number
          recording_rate_window?: unknown
          skip_cooldown?: unknown
          translation_max_ratio?: number
          translation_min_ratio?: number
          translation_rate_limit?: number
          translation_rate_window?: unknown
          updated_at?: string
        }
        Relationships: []
      }
      flags: {
        Row: {
          created_at: string
          flagger_id: string
          id: string
          reason: string
          status: Database["public"]["Enums"]["flag_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          flagger_id: string
          id?: string
          reason: string
          status?: Database["public"]["Enums"]["flag_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          flagger_id?: string
          id?: string
          reason?: string
          status?: Database["public"]["Enums"]["flag_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flags_flagger_id_fkey"
            columns: ["flagger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_samples: {
        Row: {
          created_at: string
          expected_verdict: Database["public"]["Enums"]["review_verdict"]
          id: string
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expected_verdict: Database["public"]["Enums"]["review_verdict"]
          id?: string
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expected_verdict?: Database["public"]["Enums"]["review_verdict"]
          id?: string
          target_id?: string
          target_type?: Database["public"]["Enums"]["target_type"]
          updated_at?: string
        }
        Relationships: []
      }
      language_requests: {
        Row: {
          created_at: string
          id: string
          iso_code: string | null
          name: string
          note: string | null
          requester_id: string
          status: Database["public"]["Enums"]["language_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          iso_code?: string | null
          name: string
          note?: string | null
          requester_id: string
          status?: Database["public"]["Enums"]["language_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          iso_code?: string | null
          name?: string
          note?: string | null
          requester_id?: string
          status?: Database["public"]["Enums"]["language_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "language_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      languages: {
        Row: {
          created_at: string
          has_standard_orthography: boolean
          id: string
          is_anchor: boolean
          iso_code: string
          name: string
          native_name: string | null
          special_characters: string[]
          status: Database["public"]["Enums"]["language_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          has_standard_orthography?: boolean
          id?: string
          is_anchor?: boolean
          iso_code: string
          name: string
          native_name?: string | null
          special_characters?: string[]
          status?: Database["public"]["Enums"]["language_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          has_standard_orthography?: boolean
          id?: string
          is_anchor?: boolean
          iso_code?: string
          name?: string
          native_name?: string | null
          special_characters?: string[]
          status?: Database["public"]["Enums"]["language_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          consent_accepted_at: string | null
          consent_version: string | null
          created_at: string
          display_name: string
          id: string
          is_adult_confirmed: boolean
          last_language_id: string | null
          onboarded_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          trust_score: number
          updated_at: string
        }
        Insert: {
          consent_accepted_at?: string | null
          consent_version?: string | null
          created_at?: string
          display_name: string
          id: string
          is_adult_confirmed?: boolean
          last_language_id?: string | null
          onboarded_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          trust_score?: number
          updated_at?: string
        }
        Update: {
          consent_accepted_at?: string | null
          consent_version?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_adult_confirmed?: boolean
          last_language_id?: string | null
          onboarded_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          trust_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_language_id_fkey"
            columns: ["last_language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
        ]
      }
      read_aloud_pool: {
        Row: {
          contributor_id: string
          is_active: boolean
          language_id: string
          random_key: number
          read_count: number
          sentence_id: string
          tier: number
          translation_id: string
        }
        Insert: {
          contributor_id: string
          is_active?: boolean
          language_id: string
          random_key?: number
          read_count?: number
          sentence_id: string
          tier: number
          translation_id: string
        }
        Update: {
          contributor_id?: string
          is_active?: boolean
          language_id?: string
          random_key?: number
          read_count?: number
          sentence_id?: string
          tier?: number
          translation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_aloud_pool_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_aloud_pool_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_aloud_pool_translation_id_fkey"
            columns: ["translation_id"]
            isOneToOne: true
            referencedRelation: "translations"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          auto_check_result: Json | null
          contributor_id: string
          created_at: string
          duration_ms: number | null
          id: string
          language_id: string
          mime_type: string
          mode: Database["public"]["Enums"]["recording_mode"]
          seen_anchor_language_id: string | null
          sentence_id: string
          status: Database["public"]["Enums"]["contribution_status"]
          storage_path: string
          translation_id: string | null
          updated_at: string
        }
        Insert: {
          auto_check_result?: Json | null
          contributor_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          language_id: string
          mime_type: string
          mode: Database["public"]["Enums"]["recording_mode"]
          seen_anchor_language_id?: string | null
          sentence_id: string
          status?: Database["public"]["Enums"]["contribution_status"]
          storage_path: string
          translation_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_check_result?: Json | null
          contributor_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          language_id?: string
          mime_type?: string
          mode?: Database["public"]["Enums"]["recording_mode"]
          seen_anchor_language_id?: string | null
          sentence_id?: string
          status?: Database["public"]["Enums"]["contribution_status"]
          storage_path?: string
          translation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recordings_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_seen_anchor_language_id_fkey"
            columns: ["seen_anchor_language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_translation_id_fkey"
            columns: ["translation_id"]
            isOneToOne: false
            referencedRelation: "translations"
            referencedColumns: ["id"]
          },
        ]
      }
      review_history: {
        Row: {
          changed_at: string
          id: string
          new_verdict: Database["public"]["Enums"]["review_verdict"]
          previous_verdict: Database["public"]["Enums"]["review_verdict"]
          review_id: string
        }
        Insert: {
          changed_at?: string
          id?: string
          new_verdict: Database["public"]["Enums"]["review_verdict"]
          previous_verdict: Database["public"]["Enums"]["review_verdict"]
          review_id: string
        }
        Update: {
          changed_at?: string
          id?: string
          new_verdict?: Database["public"]["Enums"]["review_verdict"]
          previous_verdict?: Database["public"]["Enums"]["review_verdict"]
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_history_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          agrees_with_flag: boolean | null
          created_at: string
          id: string
          is_stale: boolean
          reviewer_id: string
          shown_flag_after_vote: boolean
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at: string
          verdict: Database["public"]["Enums"]["review_verdict"]
        }
        Insert: {
          agrees_with_flag?: boolean | null
          created_at?: string
          id?: string
          is_stale?: boolean
          reviewer_id: string
          shown_flag_after_vote?: boolean
          target_id: string
          target_type: Database["public"]["Enums"]["target_type"]
          updated_at?: string
          verdict: Database["public"]["Enums"]["review_verdict"]
        }
        Update: {
          agrees_with_flag?: boolean | null
          created_at?: string
          id?: string
          is_stale?: boolean
          reviewer_id?: string
          shown_flag_after_vote?: boolean
          target_id?: string
          target_type?: Database["public"]["Enums"]["target_type"]
          updated_at?: string
          verdict?: Database["public"]["Enums"]["review_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sentence_coverage: {
        Row: {
          has_verified_french: boolean
          is_active: boolean
          language_id: string
          random_key: number
          recording_count: number
          sentence_id: string
          translation_count: number
        }
        Insert: {
          has_verified_french?: boolean
          is_active?: boolean
          language_id: string
          random_key: number
          recording_count?: number
          sentence_id: string
          translation_count?: number
        }
        Update: {
          has_verified_french?: boolean
          is_active?: boolean
          language_id?: string
          random_key?: number
          recording_count?: number
          sentence_id?: string
          translation_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sentence_coverage_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_coverage_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
        ]
      }
      sentence_reports: {
        Row: {
          created_at: string
          id: string
          language_id: string | null
          reason: string | null
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          sentence_id: string
          status: Database["public"]["Enums"]["flag_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_id?: string | null
          reason?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sentence_id: string
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          language_id?: string | null
          reason?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sentence_id?: string
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sentence_reports_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_reports_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
        ]
      }
      sentence_skips: {
        Row: {
          created_at: string
          id: string
          language_id: string
          note: string | null
          reason: Database["public"]["Enums"]["skip_reason"]
          sentence_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_id: string
          note?: string | null
          reason: Database["public"]["Enums"]["skip_reason"]
          sentence_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language_id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["skip_reason"]
          sentence_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sentence_skips_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_skips_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentence_skips_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sentences: {
        Row: {
          anchor_language_id: string
          created_at: string
          difficulty: number | null
          has_verified_french: boolean
          id: string
          is_active: boolean
          normalized_text: string | null
          random_key: number
          source: string
          source_license: string
          text: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          anchor_language_id: string
          created_at?: string
          difficulty?: number | null
          has_verified_french?: boolean
          id?: string
          is_active?: boolean
          normalized_text?: string | null
          random_key?: number
          source: string
          source_license: string
          text: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          anchor_language_id?: string
          created_at?: string
          difficulty?: number | null
          has_verified_french?: boolean
          id?: string
          is_active?: boolean
          normalized_text?: string | null
          random_key?: number
          source?: string
          source_license?: string
          text?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sentences_anchor_language_id_fkey"
            columns: ["anchor_language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          contributor_id: string
          created_at: string
          id: string
          recording_id: string
          status: Database["public"]["Enums"]["contribution_status"]
          text: string
          updated_at: string
        }
        Insert: {
          contributor_id: string
          created_at?: string
          id?: string
          recording_id: string
          status?: Database["public"]["Enums"]["contribution_status"]
          text: string
          updated_at?: string
        }
        Update: {
          contributor_id?: string
          created_at?: string
          id?: string
          recording_id?: string
          status?: Database["public"]["Enums"]["contribution_status"]
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcripts_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
        ]
      }
      translations: {
        Row: {
          contributor_id: string
          created_at: string
          id: string
          language_id: string
          seen_anchor_language_id: string
          sentence_id: string
          status: Database["public"]["Enums"]["contribution_status"]
          text: string
          updated_at: string
        }
        Insert: {
          contributor_id: string
          created_at?: string
          id?: string
          language_id: string
          seen_anchor_language_id: string
          sentence_id: string
          status?: Database["public"]["Enums"]["contribution_status"]
          text: string
          updated_at?: string
        }
        Update: {
          contributor_id?: string
          created_at?: string
          id?: string
          language_id?: string
          seen_anchor_language_id?: string
          sentence_id?: string
          status?: Database["public"]["Enums"]["contribution_status"]
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "translations_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "translations_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "translations_seen_anchor_language_id_fkey"
            columns: ["seen_anchor_language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "translations_sentence_id_fkey"
            columns: ["sentence_id"]
            isOneToOne: false
            referencedRelation: "sentences"
            referencedColumns: ["id"]
          },
        ]
      }
      user_languages: {
        Row: {
          ability: Database["public"]["Enums"]["language_ability"]
          created_at: string
          id: string
          language_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ability: Database["public"]["Enums"]["language_ability"]
          created_at?: string
          id?: string
          language_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ability?: Database["public"]["Enums"]["language_ability"]
          created_at?: string
          id?: string
          language_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_languages_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_languages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      review_votes: {
        Row: {
          target_id: string | null
          target_type: Database["public"]["Enums"]["target_type"] | null
          verdict: Database["public"]["Enums"]["review_verdict"] | null
          votes: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_consent: {
        Args: { p_is_adult: boolean; p_version: string }
        Returns: undefined
      }
      admin_anchor_list: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          french_status: string
          french_text: string
          french_translation_id: string
          is_active: boolean
          sentence_id: string
          text: string
          topic: string
          total_count: number
        }[]
      }
      admin_sentence_usage: {
        Args: { p_ids: string[] }
        Returns: {
          recordings: number
          sentence_id: string
          translations: number
        }[]
      }
      approve_language_request: {
        Args: {
          p_iso_code: string
          p_name: string
          p_native_name?: string
          p_request_id: string
          p_status?: Database["public"]["Enums"]["language_status"]
        }
        Returns: string
      }
      benchmark_next_sentence: {
        Args: {
          p_language_id: string
          p_runs?: number
          p_task: string
          p_user: string
        }
        Returns: number
      }
      bump_coverage: {
        Args: {
          p_column: string
          p_delta: number
          p_language: string
          p_sentence: string
        }
        Returns: undefined
      }
      contribution_owner: {
        Args: {
          p_id: string
          p_type: Database["public"]["Enums"]["target_type"]
        }
        Returns: string
      }
      current_consent_version: { Args: never; Returns: string }
      decline_language_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      find_existing_sentences: {
        Args: { p_texts: string[] }
        Returns: string[]
      }
      has_valid_consent: { Args: { p_user?: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_privileged: { Args: never; Returns: boolean }
      language_stats: {
        Args: never
        Returns: {
          contributors: number
          is_anchor: boolean
          iso_code: string
          language_id: string
          name: string
          native_name: string
          recordings: number
          status: Database["public"]["Enums"]["language_status"]
          translations: number
        }[]
      }
      my_contribution_counts: {
        Args: never
        Returns: {
          recordings: number
          reviews: number
          transcripts: number
          translations: number
        }[]
      }
      next_sentence: {
        Args: { p_exclude?: string[]; p_language_id: string; p_task: string }
        Returns: {
          anchor_iso_code: string
          anchor_language_id: string
          anchor_text: string
          sentence_id: string
        }[]
      }
      next_sentence_for_speak: {
        Args: { p_exclude?: string[]; p_language_id: string }
        Returns: {
          anchor_iso_code: string
          anchor_language_id: string
          anchor_text: string
          sentence_id: string
        }[]
      }
      next_sentence_for_write: {
        Args: { p_exclude?: string[]; p_language_id: string }
        Returns: {
          anchor_iso_code: string
          anchor_language_id: string
          anchor_text: string
          sentence_id: string
        }[]
      }
      next_translation_for_read_aloud: {
        Args: { p_exclude?: string[]; p_language_id: string }
        Returns: {
          sentence_id: string
          text: string
          translation_id: string
        }[]
      }
      normalize_sentence: { Args: { p_text: string }; Returns: string }
      onboarding_status: { Args: never; Returns: string }
      require_admin: { Args: never; Returns: undefined }
      resolve_sentence_report: {
        Args: { p_action: string; p_report_id: string }
        Returns: undefined
      }
      rule_error: {
        Args: { p_message: string; p_rule: string }
        Returns: undefined
      }
      sentence_topics: { Args: never; Returns: string[] }
      translation_error: {
        Args: { p_message: string; p_rule: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "contributor" | "admin"
      contribution_status: "pending" | "unverified" | "verified" | "rejected"
      flag_status: "open" | "confirmed" | "dismissed"
      language_ability: "native" | "fluent" | "understands"
      language_request_status: "pending" | "added" | "declined"
      language_status: "open" | "waiting_for_contributors"
      recording_mode: "translate_and_speak" | "read_aloud"
      review_verdict:
        | "same_meaning"
        | "mostly_same"
        | "different_meaning"
        | "unclear_audio"
        | "not_this_language"
      skip_reason: "not_sure" | "unclear" | "report"
      target_type: "translation" | "recording" | "transcript"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["contributor", "admin"],
      contribution_status: ["pending", "unverified", "verified", "rejected"],
      flag_status: ["open", "confirmed", "dismissed"],
      language_ability: ["native", "fluent", "understands"],
      language_request_status: ["pending", "added", "declined"],
      language_status: ["open", "waiting_for_contributors"],
      recording_mode: ["translate_and_speak", "read_aloud"],
      review_verdict: [
        "same_meaning",
        "mostly_same",
        "different_meaning",
        "unclear_audio",
        "not_this_language",
      ],
      skip_reason: ["not_sure", "unclear", "report"],
      target_type: ["translation", "recording", "transcript"],
    },
  },
} as const

