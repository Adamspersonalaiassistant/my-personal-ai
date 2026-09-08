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
