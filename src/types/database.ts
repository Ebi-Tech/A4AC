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
          updated_at: string
        }
        Insert: {
          current_consent_version: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          current_consent_version?: string
          id?: boolean
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
          onboarded_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          trust_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      recordings: {
        Row: {
          auto_check_result: Json | null
          contributor_id: string
          created_at: string
          duration_ms: number | null
          id: string
          language_id: string
          mode: Database["public"]["Enums"]["recording_mode"]
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
          mode: Database["public"]["Enums"]["recording_mode"]
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
          mode?: Database["public"]["Enums"]["recording_mode"]
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
      sentences: {
        Row: {
          anchor_language_id: string
          created_at: string
          difficulty: number | null
          id: string
          is_active: boolean
          source: string
          source_license: string
          text: string
          updated_at: string
        }
        Insert: {
          anchor_language_id: string
          created_at?: string
          difficulty?: number | null
          id?: string
          is_active?: boolean
          source: string
          source_license: string
          text: string
          updated_at?: string
        }
        Update: {
          anchor_language_id?: string
          created_at?: string
          difficulty?: number | null
          id?: string
          is_active?: boolean
          source?: string
          source_license?: string
          text?: string
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
      contribution_owner: {
        Args: {
          p_id: string
          p_type: Database["public"]["Enums"]["target_type"]
        }
        Returns: string
      }
      current_consent_version: { Args: never; Returns: string }
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
      onboarding_status: { Args: never; Returns: string }
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
      target_type: ["translation", "recording", "transcript"],
    },
  },
} as const

