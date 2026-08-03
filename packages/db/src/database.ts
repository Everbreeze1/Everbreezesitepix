export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_analyses: {
        Row: {
          created_at: string
          created_by: string
          defects: Json | null
          id: string
          labels: Json | null
          ocr_text: string | null
          photo_id: string
          provider: string
          raw_response: Json | null
          recommendations: Json | null
          report_text: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          defects?: Json | null
          id?: string
          labels?: Json | null
          ocr_text?: string | null
          photo_id: string
          provider?: string
          raw_response?: Json | null
          recommendations?: Json | null
          report_text?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          defects?: Json | null
          id?: string
          labels?: Json | null
          ocr_text?: string | null
          photo_id?: string
          provider?: string
          raw_response?: Json | null
          recommendations?: Json | null
          report_text?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_analyses_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      api_audit_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          http_status: number
          id: string
          idempotency_key: string | null
          meta: Json | null
          op: string | null
          request_id: string | null
          route: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          http_status: number
          id?: string
          idempotency_key?: string | null
          meta?: Json | null
          op?: string | null
          request_id?: string | null
          route: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          http_status?: number
          id?: string
          idempotency_key?: string | null
          meta?: Json | null
          op?: string | null
          request_id?: string | null
          route?: string
          user_id?: string | null
        }
        Relationships: []
      }
      api_idempotency_keys: {
        Row: {
          created_at: string
          id: string
          key: string
          response_body: Json | null
          response_status: number | null
          scope: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          response_body?: Json | null
          response_status?: number | null
          scope: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          response_body?: Json | null
          response_status?: number | null
          scope?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_reports: {
        Row: {
          created_at: string
          email: string | null
          feature: string | null
          id: string
          kind: string
          message: string | null
          sentiment: string | null
          source: string
          status: string
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          feature?: string | null
          id?: string
          kind?: string
          message?: string | null
          sentiment?: string | null
          source?: string
          status?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          feature?: string | null
          id?: string
          kind?: string
          message?: string | null
          sentiment?: string | null
          source?: string
          status?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          photo_id: string | null
          role: string
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          photo_id?: string | null
          role: string
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          photo_id?: string | null
          role?: string
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_shares: {
        Row: {
          allow_download: boolean
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          photo_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          allow_download?: boolean
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          photo_id: string
          revoked_at?: string | null
          token?: string
        }
        Update: {
          allow_download?: boolean
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          photo_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: []
      }
      photos: {
        Row: {
          archived: boolean
          archived_at: string | null
          caption: string | null
          created_at: string
          id: string
          image_url: string | null
          latitude: number | null
          longitude: number | null
          phase: string | null
          project_id: string
          size_bytes: number
          storage_path: string
          tags: string[]
          taken_at: string | null
          uploaded_by: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          phase?: string | null
          project_id: string
          size_bytes?: number
          storage_path: string
          tags?: string[]
          taken_at?: string | null
          uploaded_by: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          phase?: string | null
          project_id?: string
          size_bytes?: number
          storage_path?: string
          tags?: string[]
          taken_at?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          company_address: string | null
          company_logo_url: string | null
          company_phone: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          watermark_enabled: boolean
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          company_address?: string | null
          company_logo_url?: string | null
          company_phone?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
          watermark_enabled?: boolean
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          company_address?: string | null
          company_logo_url?: string | null
          company_phone?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          watermark_enabled?: boolean
        }
        Relationships: []
      }
      projects: {
        Row: {
          city: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          latitude: number | null
          location: string | null
          longitude: number | null
          name: string
          state: string | null
          status: string
          street: string | null
          tags: string[]
          updated_at: string
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          name: string
          state?: string | null
          status?: string
          street?: string | null
          tags?: string[]
          updated_at?: string
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          name?: string
          state?: string | null
          status?: string
          street?: string | null
          tags?: string[]
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          caption: string | null
          created_at: string
          duration_seconds: number
          id: string
          mime_type: string
          project_id: string
          size_bytes: number
          storage_path: string
          transcript: string | null
          uploaded_by: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          mime_type?: string
          project_id: string
          size_bytes?: number
          storage_path: string
          transcript?: string | null
          uploaded_by: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          mime_type?: string
          project_id?: string
          size_bytes?: number
          storage_path?: string
          transcript?: string | null
          uploaded_by?: string
        }
        Relationships: []
      }
      voice_usage: {
        Row: {
          char_count: number
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          char_count?: number
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          char_count?: number
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      walkthrough_photos: {
        Row: {
          created_at: string
          created_by: string
          id: string
          offset_seconds: number
          photo_id: string
          position: number
          spoken_note: string | null
          walkthrough_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          offset_seconds?: number
          photo_id: string
          position?: number
          spoken_note?: string | null
          walkthrough_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          offset_seconds?: number
          photo_id?: string
          position?: number
          spoken_note?: string | null
          walkthrough_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_photos_walkthrough_id_fkey"
            columns: ["walkthrough_id"]
            isOneToOne: false
            referencedRelation: "walkthroughs"
            referencedColumns: ["id"]
          },
        ]
      }
      walkthroughs: {
        Row: {
          created_at: string
          created_by: string
          duration_seconds: number
          ended_at: string | null
          id: string
          project_id: string
          share_token: string | null
          started_at: string
          status: string
          summary_markdown: string | null
          title: string
          transcript: string | null
          updated_at: string
          video_mime_type: string | null
          video_path: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          project_id: string
          share_token?: string | null
          started_at?: string
          status?: string
          summary_markdown?: string | null
          title?: string
          transcript?: string | null
          updated_at?: string
          video_mime_type?: string | null
          video_path?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          project_id?: string
          share_token?: string | null
          started_at?: string
          status?: string
          summary_markdown?: string | null
          title?: string
          transcript?: string | null
          updated_at?: string
          video_mime_type?: string | null
          video_path?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_cron_shared_secret: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
