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
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
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
          memory_max_characters?: number
          memory_max_items?: number
          proactive_focus_enabled?: boolean
          response_verbosity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      meetings: {
        Row: {
          action_items: Json
          created_at: string
          decisions: Json
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
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string | null
          id: string
          metadata: Json
          person_id: string | null
          priority: number
          project_id: string | null
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
          id?: string
          metadata?: Json
          person_id?: string | null
          priority?: number
          project_id?: string | null
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
          id?: string
          metadata?: Json
          person_id?: string | null
          priority?: number
          project_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
