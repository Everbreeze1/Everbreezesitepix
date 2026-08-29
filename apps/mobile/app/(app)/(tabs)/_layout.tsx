import { FolderKanban, House, Images, User } from "@/ui/icons";
import Tabs from "expo-router/js-tabs";
import { TabBar } from "@/components/TabBar";
import { Icon } from "@/ui";

/**
 * The four top-level surfaces, plus the camera the custom bar draws between
 * them.
 *
 * Which four is a judgement about the field, not a mirror of the web sidebar.
 * Web has thirteen sidebar entries because it is where the office works;
 * everything to do with authoring (templates, blueprints, the report builder,
 * the portfolio) belongs there and is deliberately absent here. What is left is
 * the set someone standing on a site opens: what needs them, the jobs, the
 * pictures, and their own account.
 *
 * **Home replaced Projects as the first tab**, and the project list moved to
 * `projects.tsx` beside it. Opening onto a list of jobs makes finding a job the
 * first thing the app is for, and it is not: knowing whether anything needs you
 * is. Activity moved out of the bar entirely and is reached from Home, because
 * "what everyone else did" is a browse surface rather than a reason to open the
 * app, and because a fifth tab would push the camera off centre. It kept its
 * `/activity` path, so nothing that linked to it broke.
 *
 * `headerShown` is off because the parent stack draws the header. Two
 * navigators both rendering one would stack two title bars on every tab.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Icon icon={House} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => <Icon icon={FolderKanban} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ color }) => <Icon icon={Images} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <Icon icon={User} size="lg" color={color} />,
        }}
      />
    </Tabs>
  );
}
