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
      agent_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json
          speaker: string
          speaker_name: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          speaker: string
          speaker_name?: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          speaker?: string
          speaker_name?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_threads: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          metadata: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          metadata?: Json
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_threads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          capabilities: Json
          created_at: string
          description: string
          id: string
          is_active: boolean
          is_internal: boolean
          metadata: Json
          mission: string
          name: string
          parent_agent_id: string | null
          persona: string
          slug: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          capabilities?: Json
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_internal?: boolean
          metadata?: Json
          mission?: string
          name: string
          parent_agent_id?: string | null
          persona?: string
          slug: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          capabilities?: Json
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_internal?: boolean
          metadata?: Json
          mission?: string
          name?: string
          parent_agent_id?: string | null
          persona?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_parent_agent_id_fkey"
            columns: ["parent_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      app_notifications: {
        Row: {
          body: string | null
          created_at: string
          delivered_at: string | null
          id: string
          metadata: Json
          read_at: string | null
          scheduled_for: string
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          scheduled_for: string
          source_ref?: string | null
          source_type?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          scheduled_for?: string
          source_ref?: string | null
          source_type?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_preferences: {
        Row: {
          category: string
          confidence: number
          created_at: string
          id: string
          is_active: boolean
          preference_key: string
          source: string | null
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          category: string
          confidence?: number
          created_at?: string
          id?: string
          is_active?: boolean
          preference_key: string
          source?: string | null
          updated_at?: string
          user_id: string
          value: Json
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          is_active?: boolean
          preference_key?: string
          source?: string | null
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          source_metadata: Json
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          source_metadata?: Json
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          source_metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: string
          created_at: string
          ended_at: string | null
          id: string
          metadata: Json
          started_at: string
          summary: string | null
          title: string | null
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json
          started_at?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json
          started_at?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          document_type: string | null
          extracted_text: string | null
          file_name: string | null
          id: string
          metadata: Json
          source: string | null
          storage_path: string | null
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          storage_path?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          storage_path?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emery_agent_metrics: {
        Row: {
          agent_slug: string
          conversation_id: string | null
          created_at: string
          delegated_count: number
          duration_ms: number | null
          id: string
          message_id: string | null
          metadata: Json
          succeeded: boolean | null
          user_id: string
          web_used: boolean
        }
        Insert: {
          agent_slug: string
          conversation_id?: string | null
          created_at?: string
          delegated_count?: number
          duration_ms?: number | null
          id?: string
          message_id?: string | null
          metadata?: Json
          succeeded?: boolean | null
          user_id: string
          web_used?: boolean
        }
        Update: {
          agent_slug?: string
          conversation_id?: string | null
          created_at?: string
          delegated_count?: number
          duration_ms?: number | null
          id?: string
          message_id?: string | null
          metadata?: Json
          succeeded?: boolean | null
          user_id?: string
          web_used?: boolean
        }
        Relationships: []
      }
      emery_config: {
        Row: {
          agent_route_confidence: number
          auto_apply_low_risk: boolean
          hpo_map_v2: boolean
          memory_max_characters: number
          memory_max_items: number
          proactive_focus_enabled: boolean
          response_verbosity: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_route_confidence?: number
          auto_apply_low_risk?: boolean
          hpo_map_v2?: boolean
          memory_max_characters?: number
          memory_max_items?: number
          proactive_focus_enabled?: boolean
          response_verbosity?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_route_confidence?: number
          auto_apply_low_risk?: boolean
          hpo_map_v2?: boolean
          memory_max_characters?: number
          memory_max_items?: number
          proactive_focus_enabled?: boolean
          response_verbosity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emery_execution_runs: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          domain: string
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          parent_run_id: string | null
          request_payload: Json
          result_payload: Json
          retry_count: number
          retryable: boolean
          source_message_id: string | null
          started_at: string | null
          status: string
          target_id: string | null
          target_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          domain: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          parent_run_id?: string | null
          request_payload?: Json
          result_payload?: Json
          retry_count?: number
          retryable?: boolean
          source_message_id?: string | null
          started_at?: string | null
          status?: string
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          domain?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          parent_run_id?: string | null
          request_payload?: Json
          result_payload?: Json
          retry_count?: number
          retryable?: boolean
          source_message_id?: string | null
          started_at?: string | null
          status?: string
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emery_execution_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "emery_execution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      emery_field_sessions: {
        Row: {
          created_at: string
          current_stop_id: string | null
          ended_at: string | null
          expected_note_account_id: string | null
          expected_note_meeting_id: string | null
          expected_note_prospect_id: string | null
          expected_note_stop_id: string | null
          id: string
          last_completed_stop_id: string | null
          metadata: Json
          optional_prospecting: boolean
          planned_meetings: Json
          route_id: string | null
          session_date: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_stop_id?: string | null
          ended_at?: string | null
          expected_note_account_id?: string | null
          expected_note_meeting_id?: string | null
          expected_note_prospect_id?: string | null
          expected_note_stop_id?: string | null
          id?: string
          last_completed_stop_id?: string | null
          metadata?: Json
          optional_prospecting?: boolean
          planned_meetings?: Json
          route_id?: string | null
          session_date: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_stop_id?: string | null
          ended_at?: string | null
          expected_note_account_id?: string | null
          expected_note_meeting_id?: string | null
          expected_note_prospect_id?: string | null
          expected_note_stop_id?: string | null
          id?: string
          last_completed_stop_id?: string | null
          metadata?: Json
          optional_prospecting?: boolean
          planned_meetings?: Json
          route_id?: string | null
          session_date?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emery_field_sessions_current_stop_id_fkey"
            columns: ["current_stop_id"]
            isOneToOne: false
            referencedRelation: "hpo_route_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_expected_note_account_id_fkey"
            columns: ["expected_note_account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_expected_note_meeting_id_fkey"
            columns: ["expected_note_meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_expected_note_prospect_id_fkey"
            columns: ["expected_note_prospect_id"]
            isOneToOne: false
            referencedRelation: "hpo_prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_expected_note_stop_id_fkey"
            columns: ["expected_note_stop_id"]
            isOneToOne: false
            referencedRelation: "hpo_route_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_last_completed_stop_id_fkey"
            columns: ["last_completed_stop_id"]
            isOneToOne: false
            referencedRelation: "hpo_route_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emery_field_sessions_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "hpo_route_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      emery_improvement_backlog: {
        Row: {
          area: string
          confidence: number
          created_at: string
          evidence: Json
          expected_benefit: string | null
          id: string
          last_observed_at: string
          occurrence_count: number
          problem_statement: string
          severity: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area: string
          confidence?: number
          created_at?: string
          evidence?: Json
          expected_benefit?: string | null
          id?: string
          last_observed_at?: string
          occurrence_count?: number
          problem_statement: string
          severity?: number
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          expected_benefit?: string | null
          id?: string
          last_observed_at?: string
          occurrence_count?: number
          problem_statement?: string
          severity?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emery_improvement_changes: {
        Row: {
          after_state: Json
          applied_at: string | null
          backlog_id: string | null
          before_state: Json
          change_type: string
          created_at: string
          id: string
          rationale: string
          rollback_state: Json
          rolled_back_at: string | null
          scope: string
          status: string
          user_id: string
          validation: Json
        }
        Insert: {
          after_state?: Json
          applied_at?: string | null
          backlog_id?: string | null
          before_state?: Json
          change_type: string
          created_at?: string
          id?: string
          rationale: string
          rollback_state?: Json
          rolled_back_at?: string | null
          scope: string
          status?: string
          user_id: string
          validation?: Json
        }
        Update: {
          after_state?: Json
          applied_at?: string | null
          backlog_id?: string | null
          before_state?: Json
          change_type?: string
          created_at?: string
          id?: string
          rationale?: string
          rollback_state?: Json
          rolled_back_at?: string | null
          scope?: string
          status?: string
          user_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "emery_improvement_changes_backlog_id_fkey"
            columns: ["backlog_id"]
            isOneToOne: false
            referencedRelation: "emery_improvement_backlog"
            referencedColumns: ["id"]
          },
        ]
      }
      emery_owner_registry: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emery_routine_runs: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          routine_key: string
          run_key: string
          status: string
          summary: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          routine_key: string
          run_key: string
          status?: string
          summary?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          routine_key?: string
          run_key?: string
          status?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      emery_runtime_events: {
        Row: {
          action: string | null
          channel: string
          created_at: string
          domain: string | null
          duration_ms: number | null
          event_type: string
          id: string
          metadata: Json
          model: string | null
          status: string
          user_id: string
        }
        Insert: {
          action?: string | null
          channel: string
          created_at?: string
          domain?: string | null
          duration_ms?: number | null
          event_type: string
          id?: string
          metadata?: Json
          model?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action?: string | null
          channel?: string
          created_at?: string
          domain?: string | null
          duration_ms?: number | null
          event_type?: string
          id?: string
          metadata?: Json
          model?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      emery_security_events: {
        Row: {
          channel: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          request_fingerprint: string | null
          severity: string
          user_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          request_fingerprint?: string | null
          severity?: string
          user_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          request_fingerprint?: string | null
          severity?: string
          user_id?: string | null
        }
        Relationships: []
      }
      emery_self_evaluations: {
        Row: {
          created_at: string
          findings: Json
          id: string
          metadata: Json
          rubric_version: string
          scores: Json
          target_ref: string | null
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          findings?: Json
          id?: string
          metadata?: Json
          rubric_version?: string
          scores?: Json
          target_ref?: string | null
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          findings?: Json
          id?: string
          metadata?: Json
          rubric_version?: string
          scores?: Json
          target_ref?: string | null
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      hpo_accounts: {
        Row: {
          account_type: string | null
          address: string | null
          blockers: string | null
          city: string | null
          created_at: string
          dedupe_key: string | null
          geocoded_at: string | null
          id: string
          last_touch_at: string | null
          latitude: number | null
          longitude: number | null
          metadata: Json
          name: string
          next_action: string | null
          next_action_due_at: string | null
          next_interaction_at: string | null
          notes: string | null
          opportunity: string | null
          owner_name: string | null
          priority: number
          relationship_health: string | null
          relationship_stage: string
          source_origin: string | null
          source_ref: string | null
          specialty: string | null
          status: string
          tags: string[]
          territory: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string | null
          address?: string | null
          blockers?: string | null
          city?: string | null
          created_at?: string
          dedupe_key?: string | null
          geocoded_at?: string | null
          id?: string
          last_touch_at?: string | null
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name: string
          next_action?: string | null
          next_action_due_at?: string | null
          next_interaction_at?: string | null
          notes?: string | null
          opportunity?: string | null
          owner_name?: string | null
          priority?: number
          relationship_health?: string | null
          relationship_stage?: string
          source_origin?: string | null
          source_ref?: string | null
          specialty?: string | null
          status?: string
          tags?: string[]
          territory?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string | null
          address?: string | null
          blockers?: string | null
          city?: string | null
          created_at?: string
          dedupe_key?: string | null
          geocoded_at?: string | null
          id?: string
          last_touch_at?: string | null
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name?: string
          next_action?: string | null
          next_action_due_at?: string | null
          next_interaction_at?: string | null
          notes?: string | null
          opportunity?: string | null
          owner_name?: string | null
          priority?: number
          relationship_health?: string | null
          relationship_stage?: string
          source_origin?: string | null
          source_ref?: string | null
          specialty?: string | null
          status?: string
          tags?: string[]
          territory?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hpo_contacts: {
        Row: {
          account_id: string
          created_at: string
          dedupe_key: string | null
          email: string | null
          id: string
          metadata: Json
          name: string
          phone: string | null
          preferred_contact_method: string | null
          relationship_notes: string | null
          role_title: string | null
          source_origin: string | null
          source_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          dedupe_key?: string | null
          email?: string | null
          id?: string
          metadata?: Json
          name: string
          phone?: string | null
          preferred_contact_method?: string | null
          relationship_notes?: string | null
          role_title?: string | null
          source_origin?: string | null
          source_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          dedupe_key?: string | null
          email?: string | null
          id?: string
          metadata?: Json
          name?: string
          phone?: string | null
          preferred_contact_method?: string | null
          relationship_notes?: string | null
          role_title?: string | null
          source_origin?: string | null
          source_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hpo_contacts_user_account_fkey"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      hpo_data_imports: {
        Row: {
          created_at: string
          id: string
          imported_count: number | null
          metadata: Json
          notes: string | null
          rejected_count: number | null
          row_count: number | null
          source_name: string | null
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          imported_count?: number | null
          metadata?: Json
          notes?: string | null
          rejected_count?: number | null
          row_count?: number | null
          source_name?: string | null
          source_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          imported_count?: number | null
          metadata?: Json
          notes?: string | null
          rejected_count?: number | null
          row_count?: number | null
          source_name?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hpo_import_payload_staging: {
        Row: {
          chunk: string
          id: number
        }
        Insert: {
          chunk: string
          id: number
        }
        Update: {
          chunk?: string
          id?: number
        }
        Relationships: []
      }
      hpo_import_rows: {
        Row: {
          created_at: string
          dedupe_key: string | null
          entity_type: string
          id: string
          import_id: string
          issue: string | null
          normalized_data: Json
          raw_data: Json
          row_number: number
          status: string
          target_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          entity_type: string
          id?: string
          import_id: string
          issue?: string | null
          normalized_data?: Json
          raw_data?: Json
          row_number: number
          status?: string
          target_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          entity_type?: string
          id?: string
          import_id?: string
          issue?: string | null
          normalized_data?: Json
          raw_data?: Json
          row_number?: number
          status?: string
          target_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hpo_import_rows_user_id_import_id_fkey"
            columns: ["user_id", "import_id"]
            isOneToOne: false
            referencedRelation: "hpo_data_imports"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      hpo_interactions: {
        Row: {
          account_id: string | null
          activity_title: string | null
          activity_type: string | null
          contact_id: string | null
          created_at: string
          id: string
          interaction_type: string
          meeting_id: string | null
          metadata: Json
          next_action: string | null
          next_action_due_at: string | null
          occurred_at: string
          outcome: string | null
          relationship_signal: string | null
          source_ref: string | null
          source_type: string
          summary: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          activity_title?: string | null
          activity_type?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          interaction_type?: string
          meeting_id?: string | null
          metadata?: Json
          next_action?: string | null
          next_action_due_at?: string | null
          occurred_at?: string
          outcome?: string | null
          relationship_signal?: string | null
          source_ref?: string | null
          source_type?: string
          summary: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          activity_title?: string | null
          activity_type?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          interaction_type?: string
          meeting_id?: string | null
          metadata?: Json
          next_action?: string | null
          next_action_due_at?: string | null
          occurred_at?: string
          outcome?: string | null
          relationship_signal?: string | null
          source_ref?: string | null
          source_type?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hpo_interactions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hpo_interactions_user_account_fkey"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "hpo_interactions_user_contact_fkey"
            columns: ["user_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "hpo_contacts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      hpo_prospects: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          disposition_reason: string | null
          fit_status: string
          geocoded_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json
          name: string
          normalized_name: string
          notes: string | null
          phone: string | null
          promoted_account_id: string | null
          promoted_at: string | null
          prospect_type: string | null
          provenance: Json
          source_ref: string | null
          source_type: string
          specialty: string | null
          territory: string | null
          updated_at: string
          user_id: string
          verification_status: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          disposition_reason?: string | null
          fit_status?: string
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name: string
          normalized_name: string
          notes?: string | null
          phone?: string | null
          promoted_account_id?: string | null
          promoted_at?: string | null
          prospect_type?: string | null
          provenance?: Json
          source_ref?: string | null
          source_type?: string
          specialty?: string | null
          territory?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          disposition_reason?: string | null
          fit_status?: string
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name?: string
          normalized_name?: string
          notes?: string | null
          phone?: string | null
          promoted_account_id?: string | null
          promoted_at?: string | null
          prospect_type?: string | null
          provenance?: Json
          source_ref?: string | null
          source_type?: string
          specialty?: string | null
          territory?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hpo_prospects_promoted_account_id_fkey"
            columns: ["promoted_account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      hpo_route_plans: {
        Row: {
          area: string | null
          created_at: string
          end_address: string | null
          end_latitude: number | null
          end_longitude: number | null
          end_window: string | null
          id: string
          metadata: Json
          notes: string | null
          optimized_at: string | null
          optimized_distance_meters: number | null
          optimized_duration_seconds: number | null
          route_date: string
          source_ref: string | null
          source_type: string
          start_address: string | null
          start_latitude: number | null
          start_longitude: number | null
          start_window: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          end_address?: string | null
          end_latitude?: number | null
          end_longitude?: number | null
          end_window?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          optimized_at?: string | null
          optimized_distance_meters?: number | null
          optimized_duration_seconds?: number | null
          route_date: string
          source_ref?: string | null
          source_type?: string
          start_address?: string | null
          start_latitude?: number | null
          start_longitude?: number | null
          start_window?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          created_at?: string
          end_address?: string | null
          end_latitude?: number | null
          end_longitude?: number | null
          end_window?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          optimized_at?: string | null
          optimized_distance_meters?: number | null
          optimized_duration_seconds?: number | null
          route_date?: string
          source_ref?: string | null
          source_type?: string
          start_address?: string | null
          start_latitude?: number | null
          start_longitude?: number | null
          start_window?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hpo_route_stops: {
        Row: {
          account_id: string | null
          address: string | null
          city: string | null
          created_at: string
          distance_meters_from_previous: number | null
          drive_seconds_from_previous: number | null
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json
          next_action: string | null
          next_action_due_at: string | null
          notes: string | null
          office_name: string | null
          planned_at: string | null
          prospect_id: string | null
          route_id: string
          status: string
          stop_order: number
          updated_at: string
          user_id: string
          visit_outcome: string | null
          visit_priority: string | null
          visit_summary: string | null
          visited_at: string | null
        }
        Insert: {
          account_id?: string | null
          address?: string | null
          city?: string | null
          created_at?: string
          distance_meters_from_previous?: number | null
          drive_seconds_from_previous?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          next_action?: string | null
          next_action_due_at?: string | null
          notes?: string | null
          office_name?: string | null
          planned_at?: string | null
          prospect_id?: string | null
          route_id: string
          status?: string
          stop_order: number
          updated_at?: string
          user_id: string
          visit_outcome?: string | null
          visit_priority?: string | null
          visit_summary?: string | null
          visited_at?: string | null
        }
        Update: {
          account_id?: string | null
          address?: string | null
          city?: string | null
          created_at?: string
          distance_meters_from_previous?: number | null
          drive_seconds_from_previous?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          next_action?: string | null
          next_action_due_at?: string | null
          notes?: string | null
          office_name?: string | null
          planned_at?: string | null
          prospect_id?: string | null
          route_id?: string
          status?: string
          stop_order?: number
          updated_at?: string
          user_id?: string
          visit_outcome?: string | null
          visit_priority?: string | null
          visit_summary?: string | null
          visited_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hpo_route_stops_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "hpo_prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hpo_route_stops_user_account_fkey"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "hpo_route_stops_user_route_fkey"
            columns: ["user_id", "route_id"]
            isOneToOne: false
            referencedRelation: "hpo_route_plans"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      hpo_sales_metrics: {
        Row: {
          account_id: string | null
          blocked_exception_count: number
          created_at: string
          entered_care_count: number
          id: string
          metadata: Json
          notes: string | null
          period_end: string
          period_start: string
          progressing_count: number
          referral_count: number
          relationship_impact_count: number
          source_ref: string | null
          source_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          blocked_exception_count?: number
          created_at?: string
          entered_care_count?: number
          id?: string
          metadata?: Json
          notes?: string | null
          period_end: string
          period_start: string
          progressing_count?: number
          referral_count?: number
          relationship_impact_count?: number
          source_ref?: string | null
          source_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          blocked_exception_count?: number
          created_at?: string
          entered_care_count?: number
          id?: string
          metadata?: Json
          notes?: string | null
          period_end?: string
          period_start?: string
          progressing_count?: number
          referral_count?: number
          relationship_impact_count?: number
          source_ref?: string | null
          source_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hpo_sales_metrics_user_account_fkey"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "hpo_accounts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      meetings: {
        Row: {
          action_items: Json
          created_at: string
          decisions: Json
          end_at: string | null
          id: string
          meeting_at: string | null
          metadata: Json
          participants: Json
          plaud_recording_id: string | null
          summary: string | null
          title: string | null
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_items?: Json
          created_at?: string
          decisions?: Json
          end_at?: string | null
          id?: string
          meeting_at?: string | null
          metadata?: Json
          participants?: Json
          plaud_recording_id?: string | null
          summary?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_items?: Json
          created_at?: string
          decisions?: Json
          end_at?: string | null
          id?: string
          meeting_at?: string | null
          metadata?: Json
          participants?: Json
          plaud_recording_id?: string | null
          summary?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          confidence: number
          content: string
          created_at: string
          expires_at: string | null
          id: string
          importance: number
          memory_type: string
          metadata: Json
          person_id: string | null
          project_id: string | null
          source_ref: string | null
          source_type: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number
          content: string
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          memory_type?: string
          metadata?: Json
          person_id?: string | null
          project_id?: string | null
          source_ref?: string | null
          source_type?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          memory_type?: string
          metadata?: Json
          person_id?: string | null
          project_id?: string | null
          source_ref?: string | null
          source_type?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memories_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          message_id: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          file_name: string
          id?: string
          message_id?: string | null
          mime_type: string
          size_bytes?: number
          storage_path: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          contact_details: Json
          created_at: string
          full_name: string
          id: string
          metadata: Json
          notes: string | null
          organization: string | null
          relationship: string | null
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_details?: Json
          created_at?: string
          full_name: string
          id?: string
          metadata?: Json
          notes?: string | null
          organization?: string | null
          relationship?: string | null
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_details?: Json
          created_at?: string
          full_name?: string
          id?: string
          metadata?: Json
          notes?: string | null
          organization?: string | null
          relationship?: string | null
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assistant_name: string | null
          created_at: string
          display_name: string | null
          profile_summary: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assistant_name?: string | null
          created_at?: string
          display_name?: string | null
          profile_summary?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assistant_name?: string | null
          created_at?: string
          display_name?: string | null
          profile_summary?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          goal: string | null
          id: string
          metadata: Json
          name: string
          next_action: string | null
          priority: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          goal?: string | null
          id?: string
          metadata?: Json
          name: string
          next_action?: string | null
          priority?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          goal?: string | null
          id?: string
          metadata?: Json
          name?: string
          next_action?: string | null
          priority?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          details?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          metadata?: Json
          person_id?: string | null
          priority?: number
          project_id?: string | null
          reminder_at?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          details?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          metadata?: Json
          person_id?: string | null
          priority?: number
          project_id?: string | null
          reminder_at?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_profile_versions: {
        Row: {
          change_request: string | null
          change_source: string
          created_at: string
          id: string
          snapshot: Json
          user_id: string
          version: number
          voice_profile_id: string
        }
        Insert: {
          change_request?: string | null
          change_source?: string
          created_at?: string
          id?: string
          snapshot: Json
          user_id: string
          version: number
          voice_profile_id: string
        }
        Update: {
          change_request?: string | null
          change_source?: string
          created_at?: string
          id?: string
          snapshot?: Json
          user_id?: string
          version?: number
          voice_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_profile_versions_voice_profile_id_fkey"
            columns: ["voice_profile_id"]
            isOneToOne: false
            referencedRelation: "voice_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_profiles: {
        Row: {
          approved_at: string | null
          base_voice_id: string | null
          contextual_preferences: Json
          created_at: string
          delivery_preferences: Json
          id: string
          pronunciation_preferences: Json
          provider_capabilities: Json
          stable_identity: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          base_voice_id?: string | null
          contextual_preferences?: Json
          created_at?: string
          delivery_preferences?: Json
          id?: string
          pronunciation_preferences?: Json
          provider_capabilities?: Json
          stable_identity?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          base_voice_id?: string | null
          contextual_preferences?: Json
          created_at?: string
          delivery_preferences?: Json
          id?: string
          pronunciation_preferences?: Json
          provider_capabilities?: Json
          stable_identity?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      emery_action_authorized: { Args: { p_user_id: string }; Returns: boolean }
      emery_action_complete_task: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_create_event: {
        Args: {
          p_end_at?: string
          p_event_type?: string
          p_participants?: Json
          p_source?: string
          p_start_at: string
          p_title: string
          p_user_id: string
        }
        Returns: {
          action_items: Json
          created_at: string
          decisions: Json
          end_at: string | null
          id: string
          meeting_at: string | null
          metadata: Json
          participants: Json
          plaud_recording_id: string | null
          summary: string | null
          title: string | null
          transcript: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "meetings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_create_task: {
        Args: {
          p_details?: string
          p_due_at?: string
          p_priority?: number
          p_source?: string
          p_title: string
          p_user_id: string
        }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_create_task_v2: {
        Args: {
          p_details?: string
          p_due_at?: string
          p_priority?: number
          p_reminder_at?: string
          p_scheduled_end_at?: string
          p_scheduled_start_at?: string
          p_source?: string
          p_title: string
          p_user_id: string
        }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_reschedule_event: {
        Args: {
          p_end_at?: string
          p_event_id: string
          p_start_at: string
          p_user_id: string
        }
        Returns: {
          action_items: Json
          created_at: string
          decisions: Json
          end_at: string | null
          id: string
          meeting_at: string | null
          metadata: Json
          participants: Json
          plaud_recording_id: string | null
          summary: string | null
          title: string | null
          transcript: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "meetings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_schedule_task: {
        Args: { p_due_at: string; p_task_id: string; p_user_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_schedule_task_v2: {
        Args: {
          p_end_at?: string
          p_reminder_at?: string
          p_start_at: string
          p_task_id: string
          p_user_id: string
        }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_set_task_deadline: {
        Args: { p_due_at: string; p_task_id: string; p_user_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_action_unschedule_task: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
          reminder_at: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          source_ref: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_hpo_apply_route_order: {
        Args: {
          p_distance_meters?: number[]
          p_drive_seconds?: number[]
          p_route_id: string
          p_stop_ids: string[]
        }
        Returns: Json
      }
      emery_hpo_consume_field_note_target: {
        Args: { p_route_id: string; p_stop_id: string }
        Returns: Json
      }
      emery_hpo_create_planner_selection: {
        Args: {
          p_area: string
          p_game_plan: Json
          p_route_date: string
          p_session_id: string
          p_stops: Json
        }
        Returns: Json
      }
      emery_hpo_finalize_planner_order: {
        Args: {
          p_distance_meters: number[]
          p_drive_seconds: number[]
          p_patch: Json
          p_route_id: string
          p_session_id: string
          p_stop_ids: string[]
        }
        Returns: Json
      }
      emery_hpo_log_touch: {
        Args: {
          p_account_id: string
          p_interaction_type: string
          p_next_action?: string
          p_next_action_due_at?: string
          p_outcome?: string
          p_relationship_signal?: string
          p_source?: string
          p_summary: string
          p_user_id: string
        }
        Returns: {
          account_id: string | null
          activity_title: string | null
          activity_type: string | null
          contact_id: string | null
          created_at: string
          id: string
          interaction_type: string
          meeting_id: string | null
          metadata: Json
          next_action: string | null
          next_action_due_at: string | null
          occurred_at: string
          outcome: string | null
          relationship_signal: string | null
          source_ref: string | null
          source_type: string
          summary: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "hpo_interactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_hpo_restore_remaining_route_stops: {
        Args: {
          p_expected_current_stop_ids: string[]
          p_previous_field_session?: Json
          p_previous_open_stops: Json
          p_route_id: string
        }
        Returns: Json
      }
      emery_hpo_set_followup: {
        Args: {
          p_account_id: string
          p_due_at?: string
          p_next_action: string
          p_source?: string
          p_user_id: string
        }
        Returns: {
          account_type: string | null
          address: string | null
          blockers: string | null
          city: string | null
          created_at: string
          dedupe_key: string | null
          geocoded_at: string | null
          id: string
          last_touch_at: string | null
          latitude: number | null
          longitude: number | null
          metadata: Json
          name: string
          next_action: string | null
          next_action_due_at: string | null
          next_interaction_at: string | null
          notes: string | null
          opportunity: string | null
          owner_name: string | null
          priority: number
          relationship_health: string | null
          relationship_stage: string
          source_origin: string | null
          source_ref: string | null
          specialty: string | null
          status: string
          tags: string[]
          territory: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "hpo_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emery_hpo_set_remaining_route_stops: {
        Args: {
          p_address?: string
          p_arm_note_target?: boolean
          p_city?: string
          p_latitude?: number
          p_longitude?: number
          p_office_name?: string
          p_route_id: string
          p_target_account_id?: string
          p_target_prospect_id?: string
          p_visit_priority?: string
        }
        Returns: Json
      }
      emery_kernel_task_create: {
        Args: {
          p_details?: string
          p_due_at?: string
          p_execution_run_id?: string
          p_idempotency_key: string
          p_parent_run_id?: string
          p_priority?: number
          p_project_id?: string
          p_reminder_at?: string
          p_scheduled_end_at?: string
          p_scheduled_start_at?: string
          p_source?: string
          p_source_channel?: string
          p_source_message_id?: string
          p_title: string
          p_user_id: string
        }
        Returns: Json
      }
      get_hpo_route_candidates: {
        Args: { p_limit?: number; p_territory?: string; p_user_id: string }
        Returns: {
          address: string
          city: string
          entity_id: string
          entity_type: string
          name: string
          priority_score: number
          reason: string
          territory: string
        }[]
      }
      get_internal_secret: { Args: { p_name: string }; Returns: string }
      is_emery_owner: { Args: never; Returns: boolean }
      run_emery_proactive_checks: { Args: never; Returns: Json }
      run_emery_safe_autotune: { Args: never; Returns: Json }
      validate_internal_cron_token: {
        Args: { p_name: string; p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
