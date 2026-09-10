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
      locations: {
        Row: {
          created_at: string
          embed_token_hash: string
          ghl_location_id: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          embed_token_hash: string
          ghl_location_id: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          embed_token_hash?: string
          ghl_location_id?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["order_event_type"]
          id: string
          location_id: string
          metadata: Json
          order_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["order_event_type"]
          id?: string
          location_id: string
          metadata?: Json
          order_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["order_event_type"]
          id?: string
          location_id?: string
          metadata?: Json
          order_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amendment_count: number
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_type: Database["public"]["Enums"]["delivery_type"]
          dispatched_at: string | null
          display_sequence: number
          first_printed_at: string | null
          ghl_contact_id: string
          id: string
          items: Json
          last_amended_at: string | null
          last_printed_at: string | null
          location_id: string
          notes: string | null
          payload_hash: string
          print_count: number
          received_at: string
          search_text: string
          source_event_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          amendment_count?: number
          created_at?: string
          customer_name: string
          customer_phone: string
          delivery_address?: string | null
          delivery_type: Database["public"]["Enums"]["delivery_type"]
          dispatched_at?: string | null
          display_sequence?: never
          first_printed_at?: string | null
          ghl_contact_id: string
          id?: string
          items: Json
          last_amended_at?: string | null
          last_printed_at?: string | null
          location_id: string
          notes?: string | null
          payload_hash: string
          print_count?: number
          received_at?: string
          search_text: string
          source_event_id: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          amendment_count?: number
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: string | null
          delivery_type?: Database["public"]["Enums"]["delivery_type"]
          dispatched_at?: string | null
          display_sequence?: never
          first_printed_at?: string | null
          ghl_contact_id?: string
          id?: string
          items?: Json
          last_amended_at?: string | null
          last_printed_at?: string | null
          location_id?: string
          notes?: string | null
          payload_hash?: string
          print_count?: number
          received_at?: string
          search_text?: string
          source_event_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      amend_order: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_delivery_address: string
          p_delivery_type: Database["public"]["Enums"]["delivery_type"]
          p_ghl_contact_id: string
          p_items: Json
          p_location_id: string
          p_notes: string
          p_payload_hash: string
          p_source_event_id: string
        }
        Returns: {
          display_sequence: number
          needs_reprint: boolean
          order_id: string
          outcome: string
          was_amended: boolean
        }[]
      }
      confirm_order_print: {
        Args: {
          p_location_id: string
          p_order_id: string
          p_request_id: string
        }
        Returns: {
          amendment_count: number
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_type: Database["public"]["Enums"]["delivery_type"]
          dispatched_at: string | null
          display_sequence: number
          first_printed_at: string | null
          ghl_contact_id: string
          id: string
          items: Json
          last_amended_at: string | null
          last_printed_at: string | null
          location_id: string
          notes: string | null
          payload_hash: string
          print_count: number
          received_at: string
          search_text: string
          source_event_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dispatch_order: {
        Args: {
          p_location_id: string
          p_order_id: string
          p_request_id: string
        }
        Returns: {
          amendment_count: number
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_type: Database["public"]["Enums"]["delivery_type"]
          dispatched_at: string | null
          display_sequence: number
          first_printed_at: string | null
          ghl_contact_id: string
          id: string
          items: Json
          last_amended_at: string | null
          last_printed_at: string | null
          location_id: string
          notes: string | null
          payload_hash: string
          print_count: number
          received_at: string
          search_text: string
          source_event_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ingest_order: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_delivery_address: string
          p_delivery_type: Database["public"]["Enums"]["delivery_type"]
          p_ghl_contact_id: string
          p_items: Json
          p_location_id: string
          p_notes: string
          p_payload_hash: string
          p_source_event_id: string
        }
        Returns: {
          display_sequence: number
          order_id: string
          payload_conflict: boolean
          was_created: boolean
        }[]
      }
    }
    Enums: {
      delivery_type: "domicilio" | "recogida"
      order_event_type: "amended" | "created" | "print_confirmed" | "dispatched"
      order_status: "pending" | "printed" | "dispatched"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      delivery_type: ["domicilio", "recogida"],
      order_event_type: ["created", "print_confirmed", "dispatched"],
      order_status: ["pending", "printed", "dispatched"],
    },
  },
} as const
