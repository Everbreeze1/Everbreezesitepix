export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          target_id: string | null;
          target_type: string | null;
        };
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_id?: string | null;
          target_type?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_id?: string | null;
          target_type?: string | null;
        };
        Relationships: [];
      };
      ai_analyses: {
        Row: {
          created_at: string;
          created_by: string;
          defects: Json;
          id: string;
          labels: string[];
          ocr_text: string | null;
          photo_id: string;
          provider: string;
          raw_response: Json | null;
          recommendations: string[];
          report_text: string | null;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          defects?: Json;
          id?: string;
          labels?: string[];
          ocr_text?: string | null;
          photo_id: string;
          provider: string;
          raw_response?: Json | null;
          recommendations?: string[];
          report_text?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          defects?: Json;
          id?: string;
          labels?: string[];
          ocr_text?: string | null;
          photo_id?: string;
          provider?: string;
          raw_response?: Json | null;
          recommendations?: string[];
          report_text?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_analyses_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
        ];
      };
      api_audit_logs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          http_status: number;
          id: string;
          idempotency_key: string | null;
          meta: Json | null;
          op: string | null;
          request_id: string | null;
          route: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          http_status: number;
          id?: string;
          idempotency_key?: string | null;
          meta?: Json | null;
          op?: string | null;
          request_id?: string | null;
          route: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          http_status?: number;
          id?: string;
          idempotency_key?: string | null;
          meta?: Json | null;
          op?: string | null;
          request_id?: string | null;
          route?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      api_idempotency_keys: {
        Row: {
          created_at: string;
          id: string;
          key: string;
          response_body: Json | null;
          response_status: number | null;
          scope: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key: string;
          response_body?: Json | null;
          response_status?: number | null;
          scope: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key?: string;
          response_body?: Json | null;
          response_status?: number | null;
          scope?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      auto_report_generations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          plan: string;
          walkthrough_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          plan: string;
          walkthrough_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          plan?: string;
          walkthrough_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auto_report_generations_walkthrough_id_fkey";
            columns: ["walkthrough_id"];
            isOneToOne: false;
            referencedRelation: "walkthroughs";
            referencedColumns: ["id"];
          },
        ];
      };
      checklist_item_photos: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          item_id: string;
          photo_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          item_id: string;
          photo_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          item_id?: string;
          photo_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checklist_item_photos_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "project_checklist_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checklist_item_photos_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
        ];
      };
      checklist_template_items: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          item_type: string;
          label: string;
          position: number;
          required: boolean;
          template_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          label: string;
          position?: number;
          required?: boolean;
          template_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          label?: string;
          position?: number;
          required?: boolean;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "checklist_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      checklist_templates: {
        Row: {
          archived: boolean;
          category: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          created_at: string;
          id: string;
          project_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          project_id?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          project_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      document_templates: {
        Row: {
          archived: boolean;
          body: Json;
          created_at: string;
          created_by: string | null;
          fields: string[];
          id: string;
          name: string;
          slug: string | null;
          team_id: string | null;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          body?: Json;
          created_at?: string;
          created_by?: string | null;
          fields?: string[];
          id?: string;
          name: string;
          slug?: string | null;
          team_id?: string | null;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          body?: Json;
          created_at?: string;
          created_by?: string | null;
          fields?: string[];
          id?: string;
          name?: string;
          slug?: string | null;
          team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_templates_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      email_send_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          message_id: string | null;
          metadata: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email?: string;
          status?: string;
          template_name?: string;
        };
        Relationships: [];
      };
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number;
          batch_size: number;
          id: number;
          retry_after_until: string | null;
          send_delay_ms: number;
          transactional_email_ttl_minutes: number;
          updated_at: string;
        };
        Insert: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Update: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_unsubscribe_tokens: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          token: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      feedback_prompt_events: {
        Row: {
          created_at: string;
          event: string;
          feature: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event: string;
          feature: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event?: string;
          feature?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      issue_reports: {
        Row: {
          attachments: string[] | null;
          client_info: Json | null;
          created_at: string | null;
          description: string | null;
          email: string | null;
          feature: string | null;
          id: string;
          kind: string;
          project_id: string | null;
          sentiment: string | null;
          source: string;
          status: string;
          url: string | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          attachments?: string[] | null;
          client_info?: Json | null;
          created_at?: string | null;
          description?: string | null;
          email?: string | null;
          feature?: string | null;
          id?: string;
          kind?: string;
          project_id?: string | null;
          sentiment?: string | null;
          source?: string;
          status?: string;
          url?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          attachments?: string[] | null;
          client_info?: Json | null;
          created_at?: string | null;
          description?: string | null;
          email?: string | null;
          feature?: string | null;
          id?: string;
          kind?: string;
          project_id?: string | null;
          sentiment?: string | null;
          source?: string;
          status?: string;
          url?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "issue_reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      job_runs: {
        Row: {
          error: string | null;
          finished_at: string | null;
          id: string;
          job: string;
          meta: Json | null;
          ok: boolean | null;
          rows_affected: number | null;
          started_at: string;
        };
        Insert: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job: string;
          meta?: Json | null;
          ok?: boolean | null;
          rows_affected?: number | null;
          started_at?: string;
        };
        Update: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job?: string;
          meta?: Json | null;
          ok?: boolean | null;
          rows_affected?: number | null;
          started_at?: string;
        };
        Relationships: [];
      };
      label_set_items: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          label_set_id: string;
          name: string;
          position: number;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          label_set_id: string;
          name: string;
          position?: number;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          label_set_id?: string;
          name?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "label_set_items_label_set_id_fkey";
            columns: ["label_set_id"];
            isOneToOne: false;
            referencedRelation: "label_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      label_sets: {
        Row: {
          archived: boolean;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          team_id: string | null;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          team_id?: string | null;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "label_sets_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      labels: {
        Row: {
          color: string;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          team_id: string | null;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          team_id?: string | null;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "labels_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          photo_id: string | null;
          role: string;
          tokens_used: number | null;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          photo_id?: string | null;
          role: string;
          tokens_used?: number | null;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          photo_id?: string | null;
          role?: string;
          tokens_used?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          body: string | null;
          created_at: string;
          emailed_at: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          link_path: string | null;
          project_id: string | null;
          read_at: string | null;
          recipient_id: string;
          title: string;
          type: string;
        };
        Insert: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          emailed_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link_path?: string | null;
          project_id?: string | null;
          read_at?: string | null;
          recipient_id: string;
          title: string;
          type: string;
        };
        Update: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          emailed_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link_path?: string | null;
          project_id?: string | null;
          read_at?: string | null;
          recipient_id?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          mentions: string[];
          photo_id: string;
          project_id: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          photo_id: string;
          project_id: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          photo_id?: string;
          project_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photo_comments_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_comments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_shares: {
        Row: {
          allow_download: boolean;
          created_at: string;
          created_by: string;
          expires_at: string | null;
          id: string;
          photo_id: string;
          revoked_at: string | null;
          token: string;
        };
        Insert: {
          allow_download?: boolean;
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          id?: string;
          photo_id: string;
          revoked_at?: string | null;
          token?: string;
        };
        Update: {
          allow_download?: boolean;
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          id?: string;
          photo_id?: string;
          revoked_at?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photo_shares_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_tags: {
        Row: {
          created_at: string;
          created_by: string | null;
          photo_id: string;
          tag_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          photo_id: string;
          tag_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          photo_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photo_tags_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      photos: {
        Row: {
          archived: boolean;
          archived_at: string | null;
          caption: string | null;
          created_at: string;
          deleted_at: string | null;
          hidden: boolean;
          id: string;
          image_url: string | null;
          latitude: number | null;
          longitude: number | null;
          phase: string | null;
          project_id: string;
          size_bytes: number | null;
          storage_path: string;
          tags: string[] | null;
          taken_at: string | null;
          thumb_path: string | null;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          archived?: boolean;
          archived_at?: string | null;
          caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          hidden?: boolean;
          id?: string;
          image_url?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          phase?: string | null;
          project_id: string;
          size_bytes?: number | null;
          storage_path: string;
          tags?: string[] | null;
          taken_at?: string | null;
          thumb_path?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          archived?: boolean;
          archived_at?: string | null;
          caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          hidden?: boolean;
          id?: string;
          image_url?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          phase?: string | null;
          project_id?: string;
          size_bytes?: number | null;
          storage_path?: string;
          tags?: string[] | null;
          taken_at?: string | null;
          thumb_path?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      pipeline_stages: {
        Row: {
          board_id: string;
          color: string;
          created_at: string;
          id: string;
          name: string;
          position: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "project_boards";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          role?: string;
          user_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      portfolios: {
        Row: {
          about_html: string | null;
          accent_color: string | null;
          address: string | null;
          business_name: string | null;
          created_at: string;
          created_by: string | null;
          cta_label: string | null;
          cta_url: string | null;
          email: string | null;
          embed_key: string;
          google_maps_url: string | null;
          google_name: string | null;
          google_place_id: string | null;
          google_rating: number | null;
          google_review_ask_url: string | null;
          google_review_count: number | null;
          google_reviews_url: string | null;
          google_synced_at: string | null;
          hero_headline: string | null;
          hero_photo_id: string | null;
          hero_subhead: string | null;
          id: string;
          logo_url: string | null;
          phone: string | null;
          published: boolean;
          seo_description: string | null;
          seo_title: string | null;
          service_areas: string[];
          services: string[];
          show_map: boolean;
          show_reviews: boolean;
          slug: string;
          team_id: string;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          about_html?: string | null;
          accent_color?: string | null;
          address?: string | null;
          business_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          email?: string | null;
          embed_key?: string;
          google_maps_url?: string | null;
          google_name?: string | null;
          google_place_id?: string | null;
          google_rating?: number | null;
          google_review_ask_url?: string | null;
          google_review_count?: number | null;
          google_reviews_url?: string | null;
          google_synced_at?: string | null;
          hero_headline?: string | null;
          hero_photo_id?: string | null;
          hero_subhead?: string | null;
          id?: string;
          logo_url?: string | null;
          phone?: string | null;
          published?: boolean;
          seo_description?: string | null;
          seo_title?: string | null;
          service_areas?: string[];
          services?: string[];
          show_map?: boolean;
          show_reviews?: boolean;
          slug: string;
          team_id: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          about_html?: string | null;
          accent_color?: string | null;
          address?: string | null;
          business_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          email?: string | null;
          embed_key?: string;
          google_maps_url?: string | null;
          google_name?: string | null;
          google_place_id?: string | null;
          google_rating?: number | null;
          google_review_ask_url?: string | null;
          google_review_count?: number | null;
          google_reviews_url?: string | null;
          google_synced_at?: string | null;
          hero_headline?: string | null;
          hero_photo_id?: string | null;
          hero_subhead?: string | null;
          id?: string;
          logo_url?: string | null;
          phone?: string | null;
          published?: boolean;
          seo_description?: string | null;
          seo_title?: string | null;
          service_areas?: string[];
          services?: string[];
          show_map?: boolean;
          show_reviews?: boolean;
          slug?: string;
          team_id?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "portfolios_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: true;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          company: string | null;
          company_address: string | null;
          company_logo_url: string | null;
          company_phone: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          job_title: string | null;
          notification_prefs: Json;
          report_photos_per_page: number;
          setup_prompt_dismissed_at: string | null;
          updated_at: string;
          watermark_enabled: boolean;
        };
        Insert: {
          avatar_url?: string | null;
          company?: string | null;
          company_address?: string | null;
          company_logo_url?: string | null;
          company_phone?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          job_title?: string | null;
          notification_prefs?: Json;
          report_photos_per_page?: number;
          setup_prompt_dismissed_at?: string | null;
          updated_at?: string;
          watermark_enabled?: boolean;
        };
        Update: {
          avatar_url?: string | null;
          company?: string | null;
          company_address?: string | null;
          company_logo_url?: string | null;
          company_phone?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          job_title?: string | null;
          notification_prefs?: Json;
          report_photos_per_page?: number;
          setup_prompt_dismissed_at?: string | null;
          updated_at?: string;
          watermark_enabled?: boolean;
        };
        Relationships: [];
      };
      project_assignments: {
        Row: {
          assigned_by: string | null;
          created_at: string;
          id: string;
          project_id: string;
          user_id: string;
        };
        Insert: {
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          project_id: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_assignments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_blueprint_applications: {
        Row: {
          applied_by: string | null;
          blueprint_id: string | null;
          blueprint_name: string | null;
          blueprint_version: number | null;
          counts: Json;
          created_at: string;
          failed_count: number;
          id: string;
          origin: string;
          project_id: string;
        };
        Insert: {
          applied_by?: string | null;
          blueprint_id?: string | null;
          blueprint_name?: string | null;
          blueprint_version?: number | null;
          counts?: Json;
          created_at?: string;
          failed_count?: number;
          id?: string;
          origin?: string;
          project_id: string;
        };
        Update: {
          applied_by?: string | null;
          blueprint_id?: string | null;
          blueprint_name?: string | null;
          blueprint_version?: number | null;
          counts?: Json;
          created_at?: string;
          failed_count?: number;
          id?: string;
          origin?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_blueprint_applications_blueprint_id_fkey";
            columns: ["blueprint_id"];
            isOneToOne: false;
            referencedRelation: "project_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_blueprint_applications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_boards: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          team_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          team_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          team_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_boards_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      project_checklist_items: {
        Row: {
          checklist_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          description: string | null;
          id: string;
          item_type: string;
          label: string;
          notes: string | null;
          position: number;
          required: boolean;
          response_value: Json | null;
        };
        Insert: {
          checklist_id: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          label: string;
          notes?: string | null;
          position?: number;
          required?: boolean;
          response_value?: Json | null;
        };
        Update: {
          checklist_id?: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          item_type?: string;
          label?: string;
          notes?: string | null;
          position?: number;
          required?: boolean;
          response_value?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_checklist_items_checklist_id_fkey";
            columns: ["checklist_id"];
            isOneToOne: false;
            referencedRelation: "project_checklists";
            referencedColumns: ["id"];
          },
        ];
      };
      project_checklists: {
        Row: {
          assigned_by: string | null;
          assigned_to: string | null;
          blueprint_application_id: string | null;
          blueprint_origin_inferred: boolean;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          notes_html: string | null;
          project_id: string;
          revoked_at: string | null;
          share_token: string;
          snapshot: Json | null;
          template_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          notes_html?: string | null;
          project_id: string;
          revoked_at?: string | null;
          share_token?: string;
          snapshot?: Json | null;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          notes_html?: string | null;
          project_id?: string;
          revoked_at?: string | null;
          share_token?: string;
          snapshot?: Json | null;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_checklists_blueprint_application_id_fkey";
            columns: ["blueprint_application_id"];
            isOneToOne: false;
            referencedRelation: "project_blueprint_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_checklists_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_checklists_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "checklist_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      project_document_folders: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          project_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name: string;
          project_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_document_folders_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_documents: {
        Row: {
          created_at: string;
          file_name: string;
          folder_id: string | null;
          id: string;
          mime_type: string | null;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          folder_id?: string | null;
          id?: string;
          mime_type?: string | null;
          project_id: string;
          size_bytes?: number;
          storage_path: string;
          uploaded_by?: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          folder_id?: string | null;
          id?: string;
          mime_type?: string | null;
          project_id?: string;
          size_bytes?: number;
          storage_path?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_documents_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "project_document_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_documents_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_group_members: {
        Row: {
          added_at: string;
          group_id: string;
          project_id: string;
        };
        Insert: {
          added_at?: string;
          group_id: string;
          project_id: string;
        };
        Update: {
          added_at?: string;
          group_id?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "project_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_group_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_groups: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_pages: {
        Row: {
          blueprint_application_id: string | null;
          blueprint_origin_inferred: boolean;
          content_html: string;
          created_at: string;
          created_by: string;
          folder_id: string | null;
          footer_html: string | null;
          header_html: string | null;
          id: string;
          project_id: string;
          revoked_at: string | null;
          share_token: string;
          source_template: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          content_html?: string;
          created_at?: string;
          created_by?: string;
          folder_id?: string | null;
          footer_html?: string | null;
          header_html?: string | null;
          id?: string;
          project_id: string;
          revoked_at?: string | null;
          share_token?: string;
          source_template?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          content_html?: string;
          created_at?: string;
          created_by?: string;
          folder_id?: string | null;
          footer_html?: string | null;
          header_html?: string | null;
          id?: string;
          project_id?: string;
          revoked_at?: string | null;
          share_token?: string;
          source_template?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_pages_blueprint_application_id_fkey";
            columns: ["blueprint_application_id"];
            isOneToOne: false;
            referencedRelation: "project_blueprint_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_pages_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "project_document_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_pages_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_report_sections: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          photos: Json;
          position: number;
          report_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          photos?: Json;
          position?: number;
          report_id: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          photos?: Json;
          position?: number;
          report_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_report_sections_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "project_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      project_reports: {
        Row: {
          allow_download: boolean;
          blueprint_application_id: string | null;
          blueprint_origin_inferred: boolean;
          cover_enabled: boolean;
          cover_photo_ids: Json;
          cover_show_address: boolean;
          cover_show_author: boolean;
          cover_show_date: boolean;
          cover_show_project_name: boolean;
          created_at: string;
          created_by: string;
          id: string;
          include_project_info: boolean;
          photo_ids: string[];
          photos_per_page: number;
          project_id: string;
          revoked_at: string | null;
          share_token: string;
          source_template: string | null;
          subtitle: string | null;
          summary: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          allow_download?: boolean;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          cover_enabled?: boolean;
          cover_photo_ids?: Json;
          cover_show_address?: boolean;
          cover_show_author?: boolean;
          cover_show_date?: boolean;
          cover_show_project_name?: boolean;
          created_at?: string;
          created_by: string;
          id?: string;
          include_project_info?: boolean;
          photo_ids?: string[];
          photos_per_page?: number;
          project_id: string;
          revoked_at?: string | null;
          share_token?: string;
          source_template?: string | null;
          subtitle?: string | null;
          summary?: string | null;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allow_download?: boolean;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          cover_enabled?: boolean;
          cover_photo_ids?: Json;
          cover_show_address?: boolean;
          cover_show_author?: boolean;
          cover_show_date?: boolean;
          cover_show_project_name?: boolean;
          created_at?: string;
          created_by?: string;
          id?: string;
          include_project_info?: boolean;
          photo_ids?: string[];
          photos_per_page?: number;
          project_id?: string;
          revoked_at?: string | null;
          share_token?: string;
          source_template?: string | null;
          subtitle?: string | null;
          summary?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_reports_blueprint_application_id_fkey";
            columns: ["blueprint_application_id"];
            isOneToOne: false;
            referencedRelation: "project_blueprint_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_site_logs: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          notes: Json;
          photo_ids: string[];
          project_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: Json;
          photo_ids?: string[];
          project_id: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: Json;
          photo_ids?: string[];
          project_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_site_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tags: {
        Row: {
          created_at: string;
          created_by: string | null;
          project_id: string;
          tag_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          project_id: string;
          tag_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          project_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tags_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      project_template_checklists: {
        Row: {
          checklist_template_id: string;
          created_at: string;
          id: string;
          position: number;
          project_template_id: string;
        };
        Insert: {
          checklist_template_id: string;
          created_at?: string;
          id?: string;
          position?: number;
          project_template_id: string;
        };
        Update: {
          checklist_template_id?: string;
          created_at?: string;
          id?: string;
          position?: number;
          project_template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_template_checklists_checklist_template_id_fkey";
            columns: ["checklist_template_id"];
            isOneToOne: false;
            referencedRelation: "checklist_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_template_checklists_project_template_id_fkey";
            columns: ["project_template_id"];
            isOneToOne: false;
            referencedRelation: "project_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      project_template_items: {
        Row: {
          config: Json;
          created_at: string;
          id: string;
          kind: string;
          position: number;
          project_template_id: string;
          ref_id: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          id?: string;
          kind: string;
          position?: number;
          project_template_id: string;
          ref_id: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          id?: string;
          kind?: string;
          position?: number;
          project_template_id?: string;
          ref_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_template_items_project_template_id_fkey";
            columns: ["project_template_id"];
            isOneToOne: false;
            referencedRelation: "project_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      project_templates: {
        Row: {
          archived: boolean;
          category: string | null;
          created_at: string;
          created_by: string;
          default_for_category: boolean;
          description: string | null;
          id: string;
          labels: string[];
          name: string;
          team_id: string | null;
          updated_at: string;
          version: number;
        };
        Insert: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by: string;
          default_for_category?: boolean;
          description?: string | null;
          id?: string;
          labels?: string[];
          name: string;
          team_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by?: string;
          default_for_category?: boolean;
          description?: string | null;
          id?: string;
          labels?: string[];
          name?: string;
          team_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "project_templates_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      project_workflow_items: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          id: string;
          kind: string;
          label: string;
          note_text: string | null;
          phase_id: string;
          photo_id: string | null;
          position: number;
          required: boolean;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          label: string;
          note_text?: string | null;
          phase_id: string;
          photo_id?: string | null;
          position?: number;
          required?: boolean;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          label?: string;
          note_text?: string | null;
          phase_id?: string;
          photo_id?: string | null;
          position?: number;
          required?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "project_workflow_items_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "project_workflow_phases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_workflow_items_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
        ];
      };
      project_workflow_phases: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          notes: string | null;
          position: number;
          requires_signoff: boolean;
          signed_off_at: string | null;
          signed_off_by: string | null;
          signoff_name: string | null;
          workflow_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          position?: number;
          requires_signoff?: boolean;
          signed_off_at?: string | null;
          signed_off_by?: string | null;
          signoff_name?: string | null;
          workflow_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          position?: number;
          requires_signoff?: boolean;
          signed_off_at?: string | null;
          signed_off_by?: string | null;
          signoff_name?: string | null;
          workflow_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_workflow_phases_workflow_id_fkey";
            columns: ["workflow_id"];
            isOneToOne: false;
            referencedRelation: "project_workflows";
            referencedColumns: ["id"];
          },
        ];
      };
      project_workflows: {
        Row: {
          assigned_by: string | null;
          assigned_to: string | null;
          blueprint_application_id: string | null;
          blueprint_origin_inferred: boolean;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          notes_html: string | null;
          project_id: string;
          revoked_at: string | null;
          share_token: string;
          source_kind: string;
          started_at: string;
          template_id: string | null;
          updated_at: string;
          updated_by: string | null;
          walkthrough_template_id: string | null;
        };
        Insert: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          notes_html?: string | null;
          project_id: string;
          revoked_at?: string | null;
          share_token?: string;
          source_kind?: string;
          started_at?: string;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          walkthrough_template_id?: string | null;
        };
        Update: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          notes_html?: string | null;
          project_id?: string;
          revoked_at?: string | null;
          share_token?: string;
          source_kind?: string;
          started_at?: string;
          template_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          walkthrough_template_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_workflows_blueprint_application_id_fkey";
            columns: ["blueprint_application_id"];
            isOneToOne: false;
            referencedRelation: "project_blueprint_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_workflows_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_workflows_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "workflow_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_workflows_walkthrough_template_id_fkey";
            columns: ["walkthrough_template_id"];
            isOneToOne: false;
            referencedRelation: "walkthrough_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          archived: boolean;
          archived_at: string | null;
          city: string | null;
          client_contact: string | null;
          client_name: string | null;
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          description: string | null;
          gps_accuracy_meters: number | null;
          gps_address: string | null;
          gps_captured_at: string | null;
          gps_latitude: number | null;
          gps_longitude: number | null;
          id: string;
          labels: string[];
          latitude: number | null;
          location: string | null;
          longitude: number | null;
          name: string;
          owner_id: string | null;
          pipeline_stage_id: string | null;
          project_number: string | null;
          scheduled_date: string | null;
          share_decided_at: string | null;
          share_revoked_at: string | null;
          share_token: string;
          starred: boolean;
          starred_at: string | null;
          state: string | null;
          status: string;
          street: string | null;
          tags: string[] | null;
          team_id: string | null;
          updated_at: string;
          zip: string | null;
        };
        Insert: {
          archived?: boolean;
          archived_at?: string | null;
          city?: string | null;
          client_contact?: string | null;
          client_name?: string | null;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          gps_accuracy_meters?: number | null;
          gps_address?: string | null;
          gps_captured_at?: string | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          labels?: string[];
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          name: string;
          owner_id?: string | null;
          pipeline_stage_id?: string | null;
          project_number?: string | null;
          scheduled_date?: string | null;
          share_decided_at?: string | null;
          share_revoked_at?: string | null;
          share_token?: string;
          starred?: boolean;
          starred_at?: string | null;
          state?: string | null;
          status?: string;
          street?: string | null;
          tags?: string[] | null;
          team_id?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Update: {
          archived?: boolean;
          archived_at?: string | null;
          city?: string | null;
          client_contact?: string | null;
          client_name?: string | null;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          gps_accuracy_meters?: number | null;
          gps_address?: string | null;
          gps_captured_at?: string | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          labels?: string[];
          latitude?: number | null;
          location?: string | null;
          longitude?: number | null;
          name?: string;
          owner_id?: string | null;
          pipeline_stage_id?: string | null;
          project_number?: string | null;
          scheduled_date?: string | null;
          share_decided_at?: string | null;
          share_revoked_at?: string | null;
          share_token?: string;
          starred?: boolean;
          starred_at?: string | null;
          state?: string | null;
          status?: string;
          street?: string | null;
          tags?: string[] | null;
          team_id?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projects_pipeline_stage_id_fkey";
            columns: ["pipeline_stage_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      report_templates: {
        Row: {
          archived: boolean;
          category: string | null;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          sections: Json;
          subtitle: string | null;
          team_id: string | null;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          sections?: Json;
          subtitle?: string | null;
          team_id?: string | null;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          sections?: Json;
          subtitle?: string | null;
          team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_templates_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_items: {
        Row: {
          caption: string | null;
          id: string;
          photo_id: string;
          position: number;
          section_id: string | null;
          showcase_id: string;
        };
        Insert: {
          caption?: string | null;
          id?: string;
          photo_id: string;
          position?: number;
          section_id?: string | null;
          showcase_id: string;
        };
        Update: {
          caption?: string | null;
          id?: string;
          photo_id?: string;
          position?: number;
          section_id?: string | null;
          showcase_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_items_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "showcase_sections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_items_showcase_id_fkey";
            columns: ["showcase_id"];
            isOneToOne: false;
            referencedRelation: "showcases";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_sections: {
        Row: {
          body_html: string | null;
          id: string;
          position: number;
          project_id: string | null;
          showcase_id: string;
          title: string | null;
        };
        Insert: {
          body_html?: string | null;
          id?: string;
          position?: number;
          project_id?: string | null;
          showcase_id: string;
          title?: string | null;
        };
        Update: {
          body_html?: string | null;
          id?: string;
          position?: number;
          project_id?: string | null;
          showcase_id?: string;
          title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_sections_showcase_id_fkey";
            columns: ["showcase_id"];
            isOneToOne: false;
            referencedRelation: "showcases";
            referencedColumns: ["id"];
          },
        ];
      };
      showcases: {
        Row: {
          accent_color: string | null;
          city: string | null;
          completed_on: string | null;
          cover_photo_id: string | null;
          created_at: string;
          created_by: string;
          featured: boolean;
          id: string;
          intro_html: string | null;
          latitude: number | null;
          layout: string;
          longitude: number | null;
          on_site: boolean;
          outro_html: string | null;
          position: number;
          products_used: string[];
          revoked_at: string | null;
          service_type: string | null;
          share_token: string;
          show_contact: boolean;
          show_reviews: boolean;
          slug: string | null;
          state: string | null;
          summary: string | null;
          tagline: string | null;
          team_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          accent_color?: string | null;
          city?: string | null;
          completed_on?: string | null;
          cover_photo_id?: string | null;
          created_at?: string;
          created_by: string;
          featured?: boolean;
          id?: string;
          intro_html?: string | null;
          latitude?: number | null;
          layout?: string;
          longitude?: number | null;
          on_site?: boolean;
          outro_html?: string | null;
          position?: number;
          products_used?: string[];
          revoked_at?: string | null;
          service_type?: string | null;
          share_token?: string;
          show_contact?: boolean;
          show_reviews?: boolean;
          slug?: string | null;
          state?: string | null;
          summary?: string | null;
          tagline?: string | null;
          team_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          accent_color?: string | null;
          city?: string | null;
          completed_on?: string | null;
          cover_photo_id?: string | null;
          created_at?: string;
          created_by?: string;
          featured?: boolean;
          id?: string;
          intro_html?: string | null;
          latitude?: number | null;
          layout?: string;
          longitude?: number | null;
          on_site?: boolean;
          outro_html?: string | null;
          position?: number;
          products_used?: string[];
          revoked_at?: string | null;
          service_type?: string | null;
          share_token?: string;
          show_contact?: boolean;
          show_reviews?: boolean;
          slug?: string | null;
          state?: string | null;
          summary?: string | null;
          tagline?: string | null;
          team_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcases_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      subcontractor_projects: {
        Row: {
          created_at: string;
          id: string;
          project_id: string;
          subcontractor_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          project_id: string;
          subcontractor_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          project_id?: string;
          subcontractor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subcontractor_projects_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subcontractor_projects_subcontractor_id_fkey";
            columns: ["subcontractor_id"];
            isOneToOne: false;
            referencedRelation: "subcontractors";
            referencedColumns: ["id"];
          },
        ];
      };
      subcontractors: {
        Row: {
          accepted_at: string | null;
          company_name: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          revoked_at: string | null;
          team_id: string;
          token: string;
          user_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          company_name?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          revoked_at?: string | null;
          team_id: string;
          token: string;
          user_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          company_name?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          team_id?: string;
          token?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subcontractors_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      suppressed_emails: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          metadata: Json | null;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          metadata?: Json | null;
          reason: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          metadata?: Json | null;
          reason?: string;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          color: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      task_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          mentions: string[];
          project_id: string;
          task_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          project_id: string;
          task_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          project_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_comments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_photo_items: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          note: string | null;
          photo_id: string;
          status: string;
          task_id: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          note?: string | null;
          photo_id: string;
          status?: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          note?: string | null;
          photo_id?: string;
          status?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_photo_items_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_photo_items_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_watchers: {
        Row: {
          added_by: string | null;
          created_at: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_watchers_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_by: string | null;
          assignee_email: string | null;
          assignee_user_id: string | null;
          blueprint_application_id: string | null;
          blueprint_origin_inferred: boolean;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          due_date: string | null;
          id: string;
          photo_ids: string[];
          position: number;
          priority: string;
          project_id: string;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          assigned_by?: string | null;
          assignee_email?: string | null;
          assignee_user_id?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          photo_ids?: string[];
          position?: number;
          priority?: string;
          project_id: string;
          status?: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          assigned_by?: string | null;
          assignee_email?: string | null;
          assignee_user_id?: string | null;
          blueprint_application_id?: string | null;
          blueprint_origin_inferred?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          photo_ids?: string[];
          position?: number;
          priority?: string;
          project_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_blueprint_application_id_fkey";
            columns: ["blueprint_application_id"];
            isOneToOne: false;
            referencedRelation: "project_blueprint_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      team_invites: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["team_role"];
          team_id: string;
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          role?: Database["public"]["Enums"]["team_role"];
          team_id: string;
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["team_role"];
          team_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          created_at: string;
          id: string;
          role: string;
          team_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: string;
          team_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: string;
          team_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_review_links: {
        Row: {
          created_at: string;
          id: string;
          label: string | null;
          platform: string;
          position: number;
          team_id: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label?: string | null;
          platform: string;
          position?: number;
          team_id: string;
          url: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string | null;
          platform?: string;
          position?: number;
          team_id?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_review_links_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          goals: string[];
          heard_from: string | null;
          id: string;
          industry: string | null;
          is_internal: boolean;
          member_limit: number;
          name: string;
          owner_id: string;
          plan: string;
          profile_completed_at: string | null;
          project_volume: string | null;
          service_area: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: string;
          team_size: string | null;
          trades: string[];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          goals?: string[];
          heard_from?: string | null;
          id?: string;
          industry?: string | null;
          is_internal?: boolean;
          member_limit?: number;
          name: string;
          owner_id: string;
          plan?: string;
          profile_completed_at?: string | null;
          project_volume?: string | null;
          service_area?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string;
          team_size?: string | null;
          trades?: string[];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          goals?: string[];
          heard_from?: string | null;
          id?: string;
          industry?: string | null;
          is_internal?: boolean;
          member_limit?: number;
          name?: string;
          owner_id?: string;
          plan?: string;
          profile_completed_at?: string | null;
          project_volume?: string | null;
          service_area?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string;
          team_size?: string | null;
          trades?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      text_snippets: {
        Row: {
          content_html: string;
          created_at: string;
          created_by: string;
          id: string;
          team_id: string | null;
          title: string;
        };
        Insert: {
          content_html: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          team_id?: string | null;
          title: string;
        };
        Update: {
          content_html?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          team_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "text_snippets_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      user_notes: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          caption: string | null;
          created_at: string;
          duration_seconds: number;
          id: string;
          mime_type: string | null;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          transcript: string | null;
          uploaded_by: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          mime_type?: string | null;
          project_id: string;
          size_bytes?: number;
          storage_path: string;
          transcript?: string | null;
          uploaded_by: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          mime_type?: string | null;
          project_id?: string;
          size_bytes?: number;
          storage_path?: string;
          transcript?: string | null;
          uploaded_by?: string;
        };
        Relationships: [];
      };
      walkthrough_photos: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          offset_seconds: number;
          photo_id: string;
          position: number;
          spoken_note: string | null;
          walkthrough_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          offset_seconds?: number;
          photo_id: string;
          position?: number;
          spoken_note?: string | null;
          walkthrough_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          offset_seconds?: number;
          photo_id?: string;
          position?: number;
          spoken_note?: string | null;
          walkthrough_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "walkthrough_photos_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walkthrough_photos_walkthrough_id_fkey";
            columns: ["walkthrough_id"];
            isOneToOne: false;
            referencedRelation: "walkthroughs";
            referencedColumns: ["id"];
          },
        ];
      };
      walkthrough_summaries: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          markdown: string | null;
          photo_notes: Json;
          project_id: string;
          share_token: string | null;
          status: string;
          title: string;
          transcript: string | null;
          updated_at: string;
          walkthrough_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          markdown?: string | null;
          photo_notes?: Json;
          project_id: string;
          share_token?: string | null;
          status?: string;
          title: string;
          transcript?: string | null;
          updated_at?: string;
          walkthrough_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          markdown?: string | null;
          photo_notes?: Json;
          project_id?: string;
          share_token?: string | null;
          status?: string;
          title?: string;
          transcript?: string | null;
          updated_at?: string;
          walkthrough_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "walkthrough_summaries_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walkthrough_summaries_walkthrough_id_fkey";
            columns: ["walkthrough_id"];
            isOneToOne: false;
            referencedRelation: "walkthroughs";
            referencedColumns: ["id"];
          },
        ];
      };
      walkthrough_template_shots: {
        Row: {
          capture: string;
          created_at: string;
          description: string | null;
          id: string;
          label: string;
          position: number;
          required: boolean;
          template_id: string;
        };
        Insert: {
          capture?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          label: string;
          position?: number;
          required?: boolean;
          template_id: string;
        };
        Update: {
          capture?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          label?: string;
          position?: number;
          required?: boolean;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "walkthrough_template_shots_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "walkthrough_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      walkthrough_templates: {
        Row: {
          archived: boolean;
          category: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      walkthroughs: {
        Row: {
          audio_url: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          duration_seconds: number;
          ended_at: string | null;
          id: string;
          narration_json: Json | null;
          project_id: string;
          share_token: string | null;
          source: string;
          started_at: string;
          status: string;
          summary_markdown: string | null;
          title: string;
          transcript: string | null;
          updated_at: string;
          video_mime_type: string | null;
          video_path: string | null;
        };
        Insert: {
          audio_url?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          duration_seconds?: number;
          ended_at?: string | null;
          id?: string;
          narration_json?: Json | null;
          project_id: string;
          share_token?: string | null;
          source?: string;
          started_at?: string;
          status?: string;
          summary_markdown?: string | null;
          title?: string;
          transcript?: string | null;
          updated_at?: string;
          video_mime_type?: string | null;
          video_path?: string | null;
        };
        Update: {
          audio_url?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          duration_seconds?: number;
          ended_at?: string | null;
          id?: string;
          narration_json?: Json | null;
          project_id?: string;
          share_token?: string | null;
          source?: string;
          started_at?: string;
          status?: string;
          summary_markdown?: string | null;
          title?: string;
          transcript?: string | null;
          updated_at?: string;
          video_mime_type?: string | null;
          video_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "walkthroughs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_template_items: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          label: string;
          phase_id: string;
          position: number;
          required: boolean;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          label: string;
          phase_id: string;
          position?: number;
          required?: boolean;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          label?: string;
          phase_id?: string;
          position?: number;
          required?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "workflow_template_items_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "workflow_template_phases";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_template_phases: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          position: number;
          requires_signoff: boolean;
          template_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          position?: number;
          requires_signoff?: boolean;
          template_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          position?: number;
          requires_signoff?: boolean;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workflow_template_phases_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "workflow_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_templates: {
        Row: {
          archived: boolean;
          category: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          category?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_api_health: {
        Args: { since: string };
        Returns: {
          distinct_users: number;
          error_4xx: number;
          error_5xx: number;
          p50_ms: number;
          p95_ms: number;
          p99_ms: number;
          total_requests: number;
        }[];
      };
      admin_api_op_stats: {
        Args: { max_rows?: number; since: string };
        Returns: {
          error_rate: number;
          errors: number;
          max_ms: number;
          op: string;
          p50_ms: number;
          p95_ms: number;
          requests: number;
        }[];
      };
      admin_api_timeseries: {
        Args: { since: string };
        Returns: {
          bucket: string;
          errors: number;
          requests: number;
        }[];
      };
      admin_project_rollups: {
        Args: { project_ids: string[] };
        Returns: {
          photo_count: number;
          project_id: string;
          storage_bytes: number;
        }[];
      };
      admin_prune_api_audit_logs: {
        Args: { keep_days?: number };
        Returns: number;
      };
      admin_team_directory: {
        Args: {
          p_desc?: boolean;
          p_limit?: number;
          p_offset?: number;
          p_plan?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: {
          created_at: string;
          id: string;
          industry: string;
          is_internal: boolean;
          last_activity_at: string;
          member_count: number;
          name: string;
          owner_email: string;
          owner_name: string;
          photo_count: number;
          plan: string;
          profile_completed_at: string;
          project_count: number;
          storage_bytes: number;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          subscription_status: string;
          team_size: string;
          total_count: number;
        }[];
      };
      admin_team_industry_mix: {
        Args: never;
        Returns: {
          industry: string;
          n: number;
          total_teams: number;
        }[];
      };
      admin_team_rollups: {
        Args: { team_ids: string[] };
        Returns: {
          member_count: number;
          photo_count: number;
          project_count: number;
          storage_bytes: number;
          team_id: string;
        }[];
      };
      admin_user_directory: {
        Args: {
          p_desc?: boolean;
          p_limit?: number;
          p_offset?: number;
          p_plan?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: {
          admin_role: string;
          banned_until: string;
          company: string;
          created_at: string;
          email: string;
          email_confirmed: boolean;
          feedback_count: number;
          full_name: string;
          id: string;
          is_platform_admin: boolean;
          last_seen_at: string;
          last_sign_in_at: string;
          project_count: number;
          requests_30d: number;
          storage_bytes: number;
          team_count: number;
          team_id: string;
          team_name: string;
          team_plan: string;
          team_role: string;
          total_count: number;
        }[];
      };
      are_teammates: { Args: { _a: string; _b: string }; Returns: boolean };
      can_see_task: {
        Args: { _task_id: string; _user_id: string };
        Returns: boolean;
      };
      create_notification: {
        Args: {
          _actor_id: string;
          _body: string;
          _entity_id: string;
          _entity_type: string;
          _link_path: string;
          _project_id: string;
          _recipient_id: string;
          _title: string;
          _type: string;
        };
        Returns: undefined;
      };
      delete_email: {
        Args: { message_id: number; queue_name: string };
        Returns: boolean;
      };
      email_confirmed_for_users: {
        Args: { user_ids: string[] };
        Returns: {
          email_confirmed: boolean;
          user_id: string;
        }[];
      };
      enqueue_email: {
        Args: { payload: Json; queue_name: string };
        Returns: number;
      };
      get_cron_shared_secret: { Args: never; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_subcontractor: { Args: { _user_id: string }; Returns: boolean };
      is_team_admin: {
        Args: { _team_id: string; _user_id: string };
        Returns: boolean;
      };
      is_team_manager: { Args: { _user_id: string }; Returns: boolean };
      is_team_member: {
        Args: { _team: string; _user: string };
        Returns: boolean;
      };
      is_team_owner: {
        Args: { _team: string; _user: string };
        Returns: boolean;
      };
      is_team_plan: { Args: { _user: string }; Returns: boolean };
      may_complete_assignment: {
        Args: { _actor: string; _assigned_by: string; _assigned_to: string };
        Returns: boolean;
      };
      member_can_reach_project: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      move_to_dlq: {
        Args: {
          dlq_name: string;
          message_id: number;
          payload: Json;
          source_queue: string;
        };
        Returns: number;
      };
      primary_team_for_user: { Args: { p_user_id: string }; Returns: string };
      purge_expired_trash: {
        Args: never;
        Returns: {
          photos_purged: number;
          projects_purged: number;
        }[];
      };
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number };
        Returns: {
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      subcontractor_can_reach_project: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      task_photo_completed_at: {
        Args: { _photo_ids: string[]; _task_id: string };
        Returns: string;
      };
      task_photo_rollup_status: {
        Args: { _current: string; _photo_ids: string[]; _task_id: string };
        Returns: string;
      };
      user_team_id: { Args: { _user_id: string }; Returns: string };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
      team_role: "owner" | "admin" | "manager" | "standard" | "member" | "restricted";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      team_role: ["owner", "admin", "manager", "standard", "member", "restricted"],
    },
  },
} as const;
